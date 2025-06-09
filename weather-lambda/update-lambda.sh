#!/bin/bash

# Build and package the Lambda function
npm run package

# # Update the Lambda function handler
# aws lambda update-function-configuration \
#   --function-name mcp-server \
#   --handler index.handler

# # Update the Lambda function code
# aws lambda update-function-code \
#   --function-name mcp-server \
#   --zip-file fileb://weather-lambda.zip

# echo "Lambda function updated successfully!"
