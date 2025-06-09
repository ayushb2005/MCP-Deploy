# Weather MCP Server - AWS Lambda Version

This is an AWS Lambda-compatible version of the Weather MCP server that provides weather tools through the Model Context Protocol (MCP).

## Features

- Implements the MCP protocol over HTTP
- Provides weather forecast and alerts tools
- Designed to run as an AWS Lambda function behind API Gateway
- Supports session management for persistent connections

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

This will compile the TypeScript code and prepare the distribution folder.

### 3. Package for Lambda Deployment

```bash
npm run package
```

This creates a `weather-lambda.zip` file that can be deployed to AWS Lambda.

## Deployment to AWS

### Using AWS CLI

```bash
aws lambda create-function \
  --function-name weather-mcp-server \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb://weather-lambda.zip \
  --role arn:aws:iam::<your-account-id>:role/lambda-execution-role \
  --timeout 30 \
  --memory-size 256
```

### API Gateway Configuration

1. Create a new REST API in API Gateway
2. Create a resource `/mcp` with POST, GET, and DELETE methods
3. Configure each method to integrate with your Lambda function
4. Deploy the API to a stage (e.g., `prod`)

## Client Configuration

Update your MCP client to point to your API Gateway endpoint:

```
MCP_SERVER_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod
```

## Important Notes

- The Lambda implementation uses in-memory session storage, which will be reset on Lambda cold starts
- For production use, consider implementing persistent session storage using DynamoDB
- The Lambda timeout should be set to accommodate longer-running weather API requests
- API Gateway might have timeout limitations for SSE connections; consider using WebSockets for truly persistent connections

## Weather Tools

The server provides two tools:

1. `get-forecast` - Get weather forecast for a location by latitude and longitude
2. `get-alerts` - Get weather alerts for a US state by two-letter state code
