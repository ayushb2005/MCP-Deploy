# Setting Up Your Bedrock Agent for MCP Integration

This guide explains how to set up an Amazon Bedrock Agent to work with MCP servers through this client.

## 1. Create a Bedrock Agent

1. Go to the Amazon Bedrock console
2. Navigate to "Agents" and click "Create agent"
3. Provide a name and description for your agent
4. Select a foundation model (Claude models work well)
5. Configure agent settings as needed
6. Click "Create"

## 2. Create Action Groups for MCP Tools

For each group of related MCP tools, create an action group:

1. In your agent configuration, go to "Action groups"
2. Click "Add action group"
3. Name your action group (e.g., "MCPWeatherTools")
4. Select "OpenAPI schema" as the definition method
5. Create an OpenAPI schema that matches your MCP tools

### Example OpenAPI Schema for Weather Tools

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "MCP Weather API",
    "version": "1.0.0",
    "description": "API for accessing weather data through MCP"
  },
  "paths": {
    "/getCurrentWeather": {
      "post": {
        "summary": "Get current weather for a location",
        "operationId": "getCurrentWeather",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "location": {
                    "type": "string",
                    "description": "Location to get weather for"
                  }
                },
                "required": ["location"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Weather data",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "location": { "type": "string" },
                    "temperature": { "type": "number" },
                    "condition": { "type": "string" },
                    "humidity": { "type": "number" },
                    "windSpeed": { "type": "number" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/getForecast": {
      "post": {
        "summary": "Get weather forecast for a location",
        "operationId": "getForecast",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "location": {
                    "type": "string",
                    "description": "Location to get forecast for"
                  },
                  "days": {
                    "type": "integer",
                    "description": "Number of days for the forecast"
                  }
                },
                "required": ["location"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Forecast data",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "location": { "type": "string" },
                    "forecast": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "date": { "type": "string" },
                          "condition": { "type": "string" },
                          "highTemp": { "type": "number" },
                          "lowTemp": { "type": "number" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## 3. Configure Agent Instructions

Add instructions to your agent to use MCP context and tools:

```
You have access to MCP (Model Context Protocol) context and tools.

MCP CONTEXT:
The MCP context is available in the session attributes under the key "mcp-context". 
This context contains information from the MCP server that you can use to answer questions.

MCP TOOLS:
You can use the following MCP tools through the action groups:
- MCPWeatherTools: Use these tools to get weather information
  - getCurrentWeather: Get current weather for a location
  - getForecast: Get weather forecast for a location

When answering questions about weather, first check the MCP context for relevant information.
If the context doesn't have what you need, use the appropriate MCP tool to get the information.
```

## 4. Create an Agent Alias

1. In your agent configuration, go to "Aliases"
2. Click "Create alias"
3. Provide a name and description
4. Select the latest draft version of your agent
5. Click "Create"

## 5. Test with the MCP Client

Now you can use the MCP client to test your agent:

```bash
node build/index.js <path_to_mcp_server_script> <agent_id> <agent_alias_id>
```

## Troubleshooting

If your agent isn't using MCP tools correctly:

1. Check that your OpenAPI schemas match your MCP tool schemas
2. Verify that your agent instructions mention the MCP tools
3. Ensure your MCP server is providing the expected tools and context
4. Look at the agent trace in the client output for debugging information
