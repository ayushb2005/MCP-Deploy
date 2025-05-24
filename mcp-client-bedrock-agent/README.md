# MCP Client for Bedrock Agent

This client integrates AWS Bedrock Agents with the Model Context Protocol (MCP), allowing Bedrock Agents to access context and tools provided by MCP servers.

## Features

- Connect to MCP servers to access tools and context
- Provide MCP context to Bedrock Agents via session attributes
- Process MCP tool calls from Bedrock Agent action groups
- Interactive chat interface

## Prerequisites

- Node.js 18+
- AWS account with Bedrock access
- AWS credentials configured
- A Bedrock Agent created and deployed with MCP action groups

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd mcp-client-bedrock-agent

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

Create a `.env` file with the following variables:

```
AWS_REGION=us-east-1
# Add other environment variables as needed
```

## Usage

Run the client with an MCP server script and your Bedrock Agent details:

```bash
node build/index.js <path_to_mcp_server_script> <agent_id> <agent_alias_id>
```

Example:

```bash
node build/index.js ../weather/build/index.js OYEMMIBBFG LTF302DSYG
```

## How It Works

1. The client connects to an MCP server to access tools and context
2. When you send a query, the client:
   - Gets context from the MCP server
   - Sends the query and context to the Bedrock Agent as session attributes
   - Processes the agent's response
   - Handles any MCP tool calls from the agent's action groups
   - Returns the final response

## Setting Up Your Bedrock Agent

To use this client effectively, your Bedrock Agent should be configured with:

1. **Action Groups for MCP Tools**: Create action groups that map to your MCP tools
2. **OpenAPI Schemas**: Define OpenAPI schemas for your action groups that match your MCP tool schemas
3. **Working with Session Attributes**: Configure your agent to access MCP context from session attributes

### Example Agent Configuration

When creating your Bedrock Agent:

1. Create an action group named "MCPTools"
2. Define API schemas that match your MCP tool schemas
3. In your agent's prompt, include instructions to use MCP context from session attributes
4. Test your agent with this client to ensure it can access MCP context and call MCP tools

## Reference

For more information, see:
- [Harness the power of MCP servers with Amazon Bedrock Agents](https://aws.amazon.com/blogs/machine-learning/harness-the-power-of-mcp-servers-with-amazon-bedrock-agents/)
- [Amazon Bedrock Agents documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [Model Context Protocol (MCP) specification](https://github.com/model-context-protocol/mcp)

## License

ISC
