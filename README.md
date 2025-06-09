# MCP HTTP Communication Setup

This repository demonstrates how to use the Model Context Protocol (MCP) with HTTP communication between client and server components.

## Project Structure

- `weather/`: MCP server that provides weather tools
- `mcp-client-typescript/`: MCP client that connects to the server and uses Claude API

## Setup Instructions

### 1. Install Dependencies

First, build both the server and client:

```bash
# Build the weather server
cd weather
npm install
npm run build

# Build the client
cd ../mcp-client-typescript
npm install
npm run build
```

### 2. Configure Environment Variables

Make sure to set your API key in the client's `.env` file:

```
# mcp-client-typescript/.env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
MCP_SERVER_URL=http://localhost:3001
```

### 3. Run the HTTP Server

Start the weather MCP server with HTTP transport:

```bash
cd weather
npm run start:http
```

The server will start on http://localhost:3001 by default.

### 4. Run the HTTP Client

In a separate terminal, start the MCP client:

```bash
cd mcp-client-typescript
npm run start:http
```

The client will connect to the server via HTTP and allow you to interact with the weather tools through Claude.

## Testing

Once both the server and client are running, you can ask questions about weather in the client terminal:

- "What's the weather forecast for San Francisco?" (latitude 37.7749, longitude -122.4194)
- "Are there any weather alerts in CA?"

## Deployment

This HTTP-based setup can be easily adapted for AWS Lambda and API Gateway:

1. Deploy the server as a Lambda function with API Gateway
2. Update the client to point to the API Gateway URL
3. Deploy the client as another Lambda function or use it from any environment
