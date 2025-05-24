import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from "@aws-sdk/client-bedrock-runtime";
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

// Define tool interface similar to Anthropic's
interface Tool {
  name: string;
  description: string | undefined;
  input_schema: object;
}

class MCPClient {
  private mcp: Client;
  private bedrockClient: BedrockRuntimeClient;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private modelId: string = "anthropic.claude-3-sonnet-20240229-v1:0"; // Updated model ID
  private inferenceProfileId: string | null = null;

  constructor(inferenceProfileId?: string) {
    this.bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
    this.mcp = new Client({ name: "mcp-client-bedrock", version: "1.0.0" });
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
      this.mcp.connect(this.transport);
  
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description || "",  // Ensure description is never undefined
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

  async processQuery(query: string) {
    // Create the initial message
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: query
          }
        ]
      }
    ];

    // Prepare tools for Bedrock format if available
    const toolsForBedrock = this.tools.length > 0 ? {
      tools: this.tools.map(tool => ({
        name: tool.name,
        description: tool.description || "",  // Ensure description is never undefined
        input_schema: tool.input_schema
      }))
    } : {};

    // Create the request payload
    const payload = {

      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      top_k: 250,
      stop_sequences: [],
      temperature: 0.7,
      top_p: 0.999,
      messages: messages,
      ...toolsForBedrock
    };

    // Invoke the Bedrock model
    const commandParams: any = {
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload)
    };
    
    const command = new InvokeModelCommand(commandParams);

    try {
      const response = await this.bedrockClient.send(command);
      
      // Parse the response
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      const finalText = [];
      const toolResults = [];

      // Process the response content
      for (const content of responseBody.content) {
        if (content.type === "text") {
          finalText.push(content.text);
        } else if (content.type === "tool_use") {
          const toolName = content.name;
          const toolArgs = content.input;

          // Call the MCP tool
          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });
          
          toolResults.push(result);
          finalText.push(
            `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
          );

          // Add the tool result to messages for follow-up
          messages.push({
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: content.id,
                name: toolName,
                input: toolArgs
              } as any
            ]
          });
          
          // Add the tool result as a tool_result type
          const toolResultContent = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: content.id,
                content: toolResultContent
              } as any
            ]
          });

          // Create a follow-up request with the tool result
          const followUpPayload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            top_k: 250,
            stop_sequences: [],
            temperature: 0.7,
            top_p: 0.999,
            messages: messages,
            tools: this.tools.length > 0 ? toolsForBedrock.tools : undefined
          };

          const followUpCommandParams: any = {
            modelId: this.modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(followUpPayload)
          };
          
          const followUpCommand = new InvokeModelCommand(followUpCommandParams);

          const followUpResponse = await this.bedrockClient.send(followUpCommand);
          const followUpBody = JSON.parse(new TextDecoder().decode(followUpResponse.body));
          
          if (followUpBody.content && followUpBody.content[0] && followUpBody.content[0].type === "text") {
            finalText.push(followUpBody.content[0].text);
          }
        }
      }

      return finalText.join("\n");
    } catch (error) {
      console.error("Error invoking Bedrock model:", error);
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    try {
      console.log("\nMCP Client with Bedrock Started with Bedrock!");
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
  
  async cleanup() {
    await this.mcp.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script> [inference_profile_id]");
    return;
  }
  
  // Get the inference profile ID from command line arguments if provided
  const inferenceProfileId = process.argv.length >= 4 ? process.argv[3] : null;
  
  const mcpClient = new MCPClient(inferenceProfileId || undefined);
  
  if (inferenceProfileId) {
    console.log(`Using inference profile ID: ${inferenceProfileId}`);
  } else {
    console.log("No inference profile ID provided. Using model ID directly.");
  }
  
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
