import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentCommandInput
} from "@aws-sdk/client-bedrock-agent-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as readline from "readline/promises";
import * as dotenv from "dotenv";

dotenv.config();

// Check for AWS region
const AWS_REGION = process.env.AWS_REGION;
if (!AWS_REGION) {
  throw new Error("AWS_REGION is not set in .env file");
}

// Define tool interface
interface Tool {
  name: string;
  description: string | undefined;
  input_schema: object;
}

class HTTPMCPClient {
  private mcp: Client;
  private bedrockAgentClient: BedrockAgentRuntimeClient;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: Tool[] = [];
  private agentId: string = "BF9XMRVPZZ";
  private agentAliasId: string = "BYCXBZM20W";
  private sessionId: string;
  private toolNameMap: Map<string, string> = new Map();

  constructor() {
    this.bedrockAgentClient = new BedrockAgentRuntimeClient({ region: AWS_REGION });
    this.mcp = new Client({ name: "mcp-http-client-bedrock-agent", version: "1.0.0" });
    this.sessionId = `session-${Date.now()}`;
  }

  async connectToHTTPServer(serverUrl: string = "http://localhost:3001/mcp") {
    try {
      this.transport = new StreamableHTTPClientTransport(new URL(serverUrl));
      
      console.log(`Connecting to HTTP MCP server: ${serverUrl}`);
      await this.mcp.connect(this.transport);
  
      // Wait a moment for the server to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        // Create normalized name mappings for easier lookup later
        const normalizedName = this.normalizeName(tool.name);
        this.toolNameMap.set(normalizedName, tool.name);
        
        return {
          name: tool.name,
          description: tool.description || "",
          input_schema: tool.inputSchema,
        };
      });
      
      console.log(
        "Connected to HTTP server with tools:",
        this.tools.map(({ name }) => name)
      );
      
    } catch (e) {
      console.error("Failed to connect to HTTP MCP server: ", e);
      throw e;
    }
  }

  // Normalize a name for comparison (remove special chars, lowercase)
  private normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  async processQuery(query: string) {
    try {
      // Get MCP context
      const mcpContext = await this.getMCPContext();
      
      console.log("MCP Context:", JSON.stringify(mcpContext, null, 2));
      
      // Create the request payload for Bedrock Agent
      const commandParams: InvokeAgentCommandInput = {
        agentId: this.agentId,
        agentAliasId: this.agentAliasId,
        sessionId: this.sessionId,
        inputText: query,
        enableTrace: true,
        endSession: false
      };
      
      // Add MCP context as session attributes if supported
      if (Object.keys(mcpContext).length > 0) {
        const sessionAttributes: Record<string, string> = {};
        sessionAttributes["mcp_context"] = JSON.stringify(mcpContext);
        (commandParams as any).sessionAttributes = sessionAttributes;
      }
      
      const command = new InvokeAgentCommand(commandParams);

      // Invoke the Bedrock Agent
      console.log("Invoking Bedrock Agent...");
      const response = await this.bedrockAgentClient.send(command);
      console.log(JSON.stringify(response));
      
      // Process the streaming response
      let finalText = "";
      
      // Check if response.completion is an AsyncIterable
      if (response.completion && Symbol.asyncIterator in response.completion) {
        // Process the streaming response
        for await (const chunk of response.completion) {
          if (chunk && typeof chunk === 'object') {
            // Check if it's a chunk with text content
            if ('chunk' in chunk && chunk.chunk && 'bytes' in chunk.chunk) {
              const textDecoder = new TextDecoder();
              const text = textDecoder.decode(chunk.chunk.bytes);
              finalText += text;
              process.stdout.write(text);
            }
            
            // Check if it's a trace
            if ('trace' in chunk) {
              console.log("\nTrace information received:", JSON.stringify(chunk.trace, null, 2));
            }
            
            // Check if it's a return control message
            if ('returnControl' in chunk) {
              console.log("\nReturn control received:", JSON.stringify(chunk.returnControl, null, 2));
              
              // Process the return control - this is where we handle MCP tool calls
              if (chunk.returnControl && chunk.returnControl.invocationInputs) {
                for (const invocation of chunk.returnControl.invocationInputs) {
                  if ('apiInvocationInput' in invocation && invocation.apiInvocationInput) {
                    const apiInput = invocation.apiInvocationInput;
                    const actionGroup = apiInput.actionGroup || '';
                    const apiPath = apiInput.apiPath || '';
                    const toolName = this.findMatchingTool(apiPath.replace('/', '') || actionGroup);
                    
                    if (toolName) {
                      // Extract parameters from the API input
                      let params: Record<string, any> = {};
                      
                      // Check for parameters in the requestBody.content["application/json"].properties array
                      if (apiInput.requestBody?.content?.["application/json"]?.properties) {
                        const properties = apiInput.requestBody.content["application/json"].properties;
                        params = properties.reduce((acc: any, prop: any) => {
                          // Convert string numbers to actual numbers if needed
                          if (prop.type === "number" && typeof prop.value === "string") {
                            acc[prop.name] = Number(prop.value);
                          } else {
                            acc[prop.name] = prop.value;
                          }
                          return acc;
                        }, {});
                      }
                      
                      console.log(`Extracted parameters for ${toolName}:`, params);
                      
                      // Call the MCP tool
                      const toolResult = await this.processMCPToolCall(toolName, params);
                      finalText += toolResult;
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        // Handle non-streaming response
        finalText = String(response.completion || "");
      }
      
      return finalText;
    } catch (error) {
      console.error("Error invoking Bedrock Agent:", error);
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Process a single MCP tool call
  private async processMCPToolCall(toolName: string, params: any): Promise<string> {
    let result = `\n\n[Calling HTTP MCP tool: ${toolName}]`;
    
    try {
      result += `\nParameters: ${JSON.stringify(params, null, 2)}`;
      
      // Call the MCP tool via HTTP
      console.log(`Calling HTTP MCP tool ${toolName} with params:`, params);
      const toolResponse = await this.mcp.callTool({
        name: toolName,
        arguments: params,
      });
      
      console.log(`HTTP MCP tool ${toolName} response:`, toolResponse);
      
      // Format the response
      if (toolResponse.content) {
        const formattedContent = typeof toolResponse.content === 'object' 
          ? JSON.stringify(toolResponse.content, null, 2)
          : toolResponse.content;
        
        result += `\nResult: ${formattedContent}`;
      } else {
        result += "\nNo content in tool response";
      }
    } catch (error) {
      console.error(`Error calling HTTP MCP tool ${toolName}:`, error);
      result += `\nError: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    return result;
  }

  // Find a matching MCP tool for an API name
  private findMatchingTool(apiName: string | undefined): string | null {
    if (!apiName) return null;
    
    // First, try direct matching
    const directMatch = this.tools.find(tool => tool.name === apiName);
    if (directMatch) {
      return directMatch.name;
    }
    
    // Try normalized matching
    const normalizedApiName = this.normalizeName(apiName);
    
    // Check if we have this normalized name in our map
    if (this.toolNameMap.has(normalizedApiName)) {
      return this.toolNameMap.get(normalizedApiName)!;
    }
    
    // Try partial matching
    for (const entry of this.toolNameMap.entries()) {
      const [normalizedName, actualName] = entry;
      if (normalizedName.includes(normalizedApiName) || normalizedApiName.includes(normalizedName)) {
        return actualName;
      }
    }
    
    // No match found
    console.warn(`No matching MCP tool found for API: ${apiName}`);
    return null;
  }

  // Get context from MCP server
  private async getMCPContext(): Promise<Record<string, any>> {
    try {
      console.log("Getting HTTP MCP context...");
      
      // Return a mock context for HTTP
      return {
        timestamp: new Date().toISOString(),
        source: "mcp-http-client",
        transport: "http",
        serverUrl: "http://localhost:3001/mcp"
      };
    } catch (error) {
      console.error("Error getting HTTP MCP context:", error);
      return {};
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    try {
      console.log("\nHTTP MCP Client with Bedrock Agent Started!");
      console.log("Type your queries or 'quit' to exit.");
      console.log(`Session ID: ${this.sessionId}`);
  
      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        await this.processQuery(message);
        console.log("\n");
      }
    } finally {
      rl.close();
    }
  }
  
  async cleanup() {
    try {
      await this.mcp.close();
      console.log("HTTP MCP connection closed");
    } catch (error) {
      console.error("Error closing HTTP MCP connection:", error);
    }
  }
}

async function main() {
  const mcpClient = new HTTPMCPClient();
  
  console.log(`Using Bedrock Agent ID: BF9XMRVPZZ`);
  console.log(`Using Bedrock Agent Alias ID: BYCXBZM20W`);
  
  try {
    await mcpClient.connectToHTTPServer("http://localhost:3001/mcp");
    await mcpClient.chatLoop();
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
