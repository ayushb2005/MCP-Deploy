import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentCommandInput
} from "@aws-sdk/client-bedrock-agent-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

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

class MCPClient {
  private mcp: Client;
  private bedrockAgentClient: BedrockAgentRuntimeClient;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private agentId: string | null = null;
  private agentAliasId: string | null = null;
  private sessionId: string;
  private toolNameMap: Map<string, string> = new Map();

  constructor(agentId?: string, agentAliasId?: string) {
    this.bedrockAgentClient = new BedrockAgentRuntimeClient({ region: AWS_REGION });
    this.mcp = new Client({ name: "mcp-client-bedrock-agent", version: "1.0.0" });
    this.agentId = agentId || null;
    this.agentAliasId = agentAliasId || null;
    this.sessionId = `session-${Date.now()}`;
  }

  async connectToServer(serverScriptPath: string) {
    try {
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;
  
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      
      console.log(`Starting MCP server: ${serverScriptPath}`);
      this.mcp.connect(this.transport);
  
      // Wait a moment for the server to start
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get server capabilities - using custom method since getCapabilities doesn't exist
      // await this.getServerCapabilities();
      
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
        "Connected to server with tools:",
        this.tools.map(({ name }) => name)
      );
      
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }


  // Normalize a name for comparison (remove special chars, lowercase)
  private normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  async processQuery(query: string) {
    if (!this.agentId || !this.agentAliasId) {
      throw new Error("Agent ID and Agent Alias ID must be provided");
    }

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
        // Create session attributes object
        const sessionAttributes: Record<string, string> = {};
        
        // Add MCP context as a single attribute
        sessionAttributes["mcp_context"] = JSON.stringify(mcpContext);
        
        // Add session attributes to command params
        // Note: We're using type assertion here since the TypeScript definitions
        // might not be up to date with the actual API
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
              // Print each chunk as it arrives
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
                      
                      // Check for parameters in the parameters array
                      if (apiInput.parameters && apiInput.parameters.length > 0) {
                        params = apiInput.parameters.reduce((acc: any, param: any) => {
                          acc[param.name] = param.value;
                          return acc;
                        }, {});
                      }
                      // Also check for parameters in the requestBody.content["application/json"].properties array
                      else if (apiInput.requestBody?.content?.["application/json"]?.properties) {
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
                      const toolResult = await this.processMCPToolCall(toolName, { apiParams: JSON.stringify(params) });
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
        finalText = response.completion || "";
      }
      
      return finalText;
    } catch (error) {
      console.error("Error invoking Bedrock Agent:", error);
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Process action groups from the agent response
  private async processActionGroups(actionGroups: any[]): Promise<string> {
    let result = "";
    
    try {
      for (const actionGroup of actionGroups) {
        console.log(`Processing action group: ${actionGroup.actionGroupName || "unnamed"}`);
        
        if (!actionGroup.actionGroupExecutions || actionGroup.actionGroupExecutions.length === 0) {
          console.log("No executions in this action group");
          continue;
        }
        
        for (const execution of actionGroup.actionGroupExecutions) {
          if (!execution.apiExecutions || execution.apiExecutions.length === 0) {
            console.log("No API executions in this execution");
            continue;
          }
          
          for (const apiExecution of execution.apiExecutions) {
            console.log(`Processing API execution: ${apiExecution.apiName || "unnamed"}`);
            
            // Try to find a matching MCP tool
            const toolName = this.findMatchingTool(apiExecution.apiName);
            
            if (toolName) {
              result += await this.processMCPToolCall(toolName, apiExecution);
            } else {
              // Not an MCP tool or no match found
              result += `\n\n[Agent used API: ${apiExecution.apiName || "unnamed"}]`;
              if (apiExecution.apiResponse) {
                try {
                  const response = JSON.parse(apiExecution.apiResponse);
                  result += `\nResponse: ${JSON.stringify(response, null, 2)}`;
                } catch (e) {
                  result += `\nResponse: ${apiExecution.apiResponse}`;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error in processActionGroups:", error);
      result += `\n\nError processing action groups: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    return result;
  }

  // Process a single MCP tool call
  private async processMCPToolCall(toolName: string, apiExecution: any): Promise<string> {
    let result = `\n\n[Calling MCP tool: ${toolName}]`;
    
    try {
      if (!apiExecution.apiParams) {
        return result + "\nError: No parameters provided for tool call";
      }
      
      // Parse the API parameters
      let params: any;
      try {
        params = JSON.parse(apiExecution.apiParams);
      } catch (e) {
        return result + `\nError parsing parameters: ${e instanceof Error ? e.message : String(e)}`;
      }
      
      result += `\nParameters: ${JSON.stringify(params, null, 2)}`;
      
      // Call the MCP tool
      console.log(`Calling MCP tool ${toolName} with params:`, params);
      const toolResponse = await this.mcp.callTool({
        name: toolName,
        arguments: params,
      });
      
      console.log(`MCP tool ${toolName} response:`, toolResponse);
      
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
      console.error(`Error calling MCP tool ${toolName}:`, error);
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
    for (const [normalizedName, actualName] of this.toolNameMap.entries()) {
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
      // Since rpc doesn't exist, we'll create a simple mock context
      console.log("Getting MCP context...");
      
      // Return a mock context
      return {
        timestamp: new Date().toISOString(),
        source: "mcp-client",
        mock: true
      };
    } catch (error) {
      console.error("Error getting MCP context:", error);
      return {};
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    try {
      console.log("\nMCP Client with Bedrock Agent Started!");
      console.log("Type your queries or 'quit' to exit.");
      console.log(`Session ID: ${this.sessionId}`);
  
      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        await this.processQuery(message);
        // The response is already printed during streaming, so we don't need to print it again
        // Just add a newline for better formatting
        console.log("\n");
      }
    } finally {
      rl.close();
    }
  }
  
  async cleanup() {
    try {
      await this.mcp.close();
      console.log("MCP connection closed");
    } catch (error) {
      console.error("Error closing MCP connection:", error);
    }
  }
}

async function main() {
  if (process.argv.length < 5) {
    console.log("Usage: node index.js <path_to_server_script> <agent_id> <agent_alias_id>");
    return;
  }
  
  const serverScriptPath = process.argv[2];
  const agentId = process.argv[3];
  const agentAliasId = process.argv[4];
  
  const mcpClient = new MCPClient(agentId, agentAliasId);
  
  console.log(`Using Bedrock Agent ID: ${agentId}`);
  console.log(`Using Bedrock Agent Alias ID: ${agentAliasId}`);
  
  try {
    await mcpClient.connectToServer(serverScriptPath);
    await mcpClient.chatLoop();
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
