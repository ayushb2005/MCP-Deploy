import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

// Default to localhost:3001 if not specified
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3001";

// Define response type for debugFetch
interface DebugResponse {
  status: number;
  headers: { [key: string]: string };
  body: any;
  isBase64Encoded: boolean;
}

// Debug fetch function to help troubleshoot API Gateway issues
async function debugFetch(url: string, options: RequestInit): Promise<DebugResponse> {
  console.log('Request:', { url, method: options.method, headers: options.headers });
  try {
    const response = await fetch(url, options);
    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response headers:', Object.fromEntries([...response.headers]));
    console.log('Response body preview:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
    
    // Try to parse as JSON if possible
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }
    
    return { 
      status: response.status, 
      headers: Object.fromEntries([...response.headers]), 
      body,
      isBase64Encoded: false
    };
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
}

class MCPAPIGatewayClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private tools: Tool[] = [];
  private sessionId: string | null = null;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  async connectToServer() {
    try {
      // First, try to get a session
      console.log("Initializing session...");
      try {
        const response = await debugFetch(`${MCP_SERVER_URL}/mcp`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'MCP-Client/1.0'
          }
        });
        
        if (response.status === 200) {
          console.log("Session response:", response);
          
          if (response.headers && response.headers['mcp-session-id']) {
            this.sessionId = response.headers['mcp-session-id'];
            console.log(`Session initialized with ID: ${this.sessionId}`);
          } else if (response.body) {
            try {
              const bodyObj = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
              if (bodyObj.sessionId) {
                this.sessionId = bodyObj.sessionId;
                console.log(`Session initialized with ID: ${this.sessionId}`);
              }
            } catch (e) {
              console.log("Failed to parse session info from response");
            }
          }
        } else {
          console.error(`Failed to initialize session: ${response.status}`);
        }
      } catch (e) {
        console.log("Failed to initialize session:", e);
      }
      
      // Now list tools using direct fetch
      console.log("Listing tools...");
      const toolsResponse = await debugFetch(`${MCP_SERVER_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'MCP-Client/1.0',
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {})
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "listTools",
          params: {},
          id: "1"
        })
      });
      
      if (toolsResponse.status !== 200) {
        throw new Error(`HTTP error! status: ${toolsResponse.status}`);
      }
      
      console.log("Tools response:", toolsResponse);
      
      // Extract tools from API Gateway response
      let toolsList = [];
      if (toolsResponse.body) {
        try {
          const bodyObj = typeof toolsResponse.body === 'string' ? JSON.parse(toolsResponse.body) : toolsResponse.body;
          if (bodyObj.result && bodyObj.result.tools) {
            toolsList = bodyObj.result.tools;
          } else if (bodyObj.jsonrpc && bodyObj.result && bodyObj.result.tools) {
            toolsList = bodyObj.result.tools;
          } else if (bodyObj.body) {
            // Handle nested body structure from API Gateway
            const nestedBody = typeof bodyObj.body === 'string' ? JSON.parse(bodyObj.body) : bodyObj.body;
            if (nestedBody.result && nestedBody.result.tools) {
              toolsList = nestedBody.result.tools;
            }
          }
        } catch (e) {
          console.log("Failed to parse tools from response:", e);
        }
      }
      
      this.tools = toolsList.map((tool: any) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      
      console.log(
        "Connected to server with tools:",
        this.tools.map(({ name }) => name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async callTool(name: string, args: any): Promise<DebugResponse> {
    try {
      const response = await debugFetch(`${MCP_SERVER_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'MCP-Client/1.0',
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {})
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "callTool",
          params: {
            name,
            arguments: args
          },
          id: "2"
        })
      });
      
      if (response.status !== 200) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      console.log("Tool call response:", response);
      
      return response;
    } catch (e) {
      console.log("Error calling tool:", e);
      throw e;
    }
  }

  async processQuery(query: string) {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];
  
    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });
  
    const finalText = [];
    const toolResults = [];
  
    for (const content of response.content) {
      if (content.type === "text") {
        finalText.push(content.text);
      } else if (content.type === "tool_use") {
        const toolName = content.name;
        const toolArgs = content.input as { [x: string]: unknown } | undefined;
  
        console.log(`Calling tool ${toolName} with args:`, JSON.stringify(toolArgs, null, 2));
        
        try {
          const result = await this.callTool(toolName, toolArgs);
          
          toolResults.push(result);
          finalText.push(
            `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
          );
    
          // Extract the actual content from the API Gateway response
          let toolContent = "";
          if (result.body) {
            try {
              const bodyObj = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
              if (bodyObj.result && bodyObj.result.content) {
                toolContent = bodyObj.result.content;
              } else if (bodyObj.jsonrpc && bodyObj.result && bodyObj.result.content) {
                toolContent = bodyObj.result.content;
              } else if (bodyObj.body) {
                // Handle nested body structure from API Gateway
                const nestedBody = typeof bodyObj.body === 'string' ? JSON.parse(bodyObj.body) : bodyObj.body;
                if (nestedBody.result && nestedBody.result.content) {
                  toolContent = nestedBody.result.content;
                } else {
                  toolContent = "Tool returned: " + JSON.stringify(nestedBody);
                }
              } else {
                toolContent = "Tool returned: " + JSON.stringify(bodyObj);
              }
            } catch (e) {
              toolContent = "Error parsing tool result: " + JSON.stringify(result.body);
            }
          } else {
            toolContent = "Tool returned: " + JSON.stringify(result);
          }
          
          console.log("Extracted tool content:", toolContent);
    
          messages.push({
            role: "user",
            content: toolContent,
          });
    
          const followUpResponse = await this.anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            messages,
          });
    
          finalText.push(
            followUpResponse.content[0].type === "text" ? followUpResponse.content[0].text : ""
          );
        } catch (error) {
          finalText.push(`Error calling tool ${toolName}: ${error}`);
        }
      }
    }
  
    return finalText.join("\n");
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    try {
      console.log("\nMCP API Gateway Client Started!");
      console.log(`Connected to server at: ${MCP_SERVER_URL}`);
      console.log("Type your queries or 'quit' to exit.");
  
      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }
}

async function main() {
    const mcpClient = new MCPAPIGatewayClient();
    try {
      await mcpClient.connectToServer();
      await mcpClient.chatLoop();
    } catch (e) {
      console.error("Error in main:", e);
    }
  }
  
  main();
