// AWS Lambda handler for Weather MCP Server

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import serverless from "serverless-http";
import { APIGatewayProxyEvent, Context } from "aws-lambda";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Store tools for direct access
const weatherTools: any[] = [];

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
  };
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Add tools to our tools array
weatherTools.push({
  name: "get-alerts",
  description: "Get weather alerts for a state",
  inputSchema: {
    type: "object",
    properties: {
      state: {
        type: "string",
        description: "Two-letter state code (e.g. CA, NY)"
      }
    },
    required: ["state"]
  },
  handler: async ({ state }: { state: string }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  }
});

weatherTools.push({
  name: "get-forecast",
  description: "Get weather forecast for a location",
  inputSchema: {
    type: "object",
    properties: {
      latitude: {
        type: "number",
        description: "Latitude of the location"
      },
      longitude: {
        type: "number",
        description: "Longitude of the location"
      }
    },
    required: ["latitude", "longitude"]
  },
  handler: async ({ latitude, longitude }: { latitude: number, longitude: number }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    // Get forecast data
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No forecast periods available",
          },
        ],
      };
    }

    // Format forecast periods
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n"),
    );

    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  }
});

// In-memory storage for session data (Note: this will be reset on Lambda cold starts)
// For production, use DynamoDB or another persistent store
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Helper function to process JSON-RPC requests directly
async function processJsonRpcRequest(req: any, res: any, body: any) {
  console.log('Processing JSON-RPC request:', body);
  
  // Check if this is a valid JSON-RPC request
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
      id: body?.id || null,
    });
  }
  
  // Get or create a session
  const sessionId = req.headers['mcp-session-id'] as string;
  let transport: any;
  
  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else {
    // New initialization request
    const eventStore = new InMemoryEventStore();
    const newSessionId = randomUUID();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
      eventStore, // Enable resumability
      onsessioninitialized: (sid) => {
        // Store the transport by session ID when session is initialized
        console.log(`Session initialized with ID: ${sid}`);
        transports[sid] = transport;
      }
    });
    
    // Set up onclose handler to clean up transport when closed
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && transports[sid]) {
        console.log(`Transport closed for session ${sid}, removing from transports map`);
        delete transports[sid];
      }
    };
    
    // Connect the transport to the MCP server
    await server.connect(transport);
    
    // Set the session ID header
    res.setHeader('mcp-session-id', newSessionId);
  }
  
  // Handle the JSON-RPC request
  try {
    // For listTools method, handle it directly for better API Gateway compatibility
    if (body.method === 'listTools') {
      // Get the tools from our array
      const tools = {
        tools: weatherTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };
      
      return res.status(200).json({
        jsonrpc: '2.0',
        result: tools,
        id: body.id,
      });
    }
    
    // For callTool method, handle it directly
    if (body.method === 'callTool' && body.params) {
      const { name, arguments: args } = body.params;
      
      // Find the tool
      const tool = weatherTools.find(t => t.name === name);
      if (!tool) {
        return res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Tool '${name}' not found`,
          },
          id: body.id,
        });
      }
      
      // Call the tool
      try {
        const result = await tool.handler(args);
        return res.status(200).json({
          jsonrpc: '2.0',
          result,
          id: body.id,
        });
      } catch (error: any) {
        console.error(`Error calling tool ${name}:`, error);
        return res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `Error calling tool ${name}: ${error.message}`,
          },
          id: body.id,
        });
      }
    }
    
    // For other methods, use the transport
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error('Error handling JSON-RPC request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: body?.id || null,
      });
    }
  }
}

// Set up Express app
const app = express();
app.use(express.json());

// Handle POST requests to both root and /mcp paths for API Gateway integration
app.post(['/', '/mcp'], async (req: any, res: any) => {
  console.log('Received POST request at path:', req.path);
  console.log('Request body:', req.body);
  
  try {
    // Check if this is a JSON-RPC request
    if (req.body && req.body.jsonrpc === '2.0') {
      return await processJsonRpcRequest(req, res, req.body);
    }
    
    // If not a JSON-RPC request, handle as before
    const sessionId = req.headers['mcp-session-id'] as string;
    let transport: any;
    
    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else {
      // New initialization request
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore, // Enable resumability
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID when session is initialized
          console.log(`Session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });
      
      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
        }
      };
      
      // Connect the transport to the MCP server
      await server.connect(transport);
    }
    
    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Handle GET requests for SSE streams on both root and /mcp paths
app.get(['/', '/mcp'], async (req:any, res:any) => {
  console.log('Received GET request at path:', req.path);
  const sessionId = req.headers['mcp-session-id'] as string;
  
  // Special case for API Gateway testing - create a test session if none exists
  if (!sessionId || !transports[sessionId]) {
    console.log('No valid session ID provided, creating test session for API Gateway testing');
    
    // Create a test session with a fixed ID for testing
    const testSessionId = 'test-session-' + randomUUID();
    const eventStore = new InMemoryEventStore();
    const testTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => testSessionId,
      eventStore,
      onsessioninitialized: (sid) => {
        console.log(`Test session initialized with ID: ${sid}`);
        transports[sid] = testTransport;
      }
    });
    
    // Connect the transport to the MCP server
    await server.connect(testTransport);
    
    // Set the session ID header in the response
    res.setHeader('mcp-session-id', testSessionId);
    
    // Return a success message with tools list for API Gateway testing
    const tools = {
      tools: weatherTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
    
    return res.status(200).json({
      jsonrpc: '2.0',
      result: tools,
      id: 'test-request',
      status: 'success',
      message: 'Test session created',
      sessionId: testSessionId
    });
  }
  
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// Handle DELETE requests for session termination on both root and /mcp paths
app.delete(['/', '/mcp'], async (req:any, res:any) => {
  console.log('Received DELETE request at path:', req.path);
  const sessionId = req.headers['mcp-session-id'] as string;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid or missing session ID'
    });
    return;
  }
  
  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'Error processing session termination'
      });
    }
  }
});

// Add a debug endpoint to check if the server is running
app.get('/debug', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Weather MCP Server is running',
    activeSessions: Object.keys(transports).length,
    sessionIds: Object.keys(transports),
    timestamp: new Date().toISOString()
  });
});

// Create serverless handler
const serverlessHandler = serverless(app);

// Lambda handler function
export const handler = async (event: APIGatewayProxyEvent, context: Context) => {
  // Log the incoming event for debugging
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  // Set context callbackWaitsForEmptyEventLoop to false to prevent Lambda from waiting
  // This is important for SSE connections which are long-lived
  context.callbackWaitsForEmptyEventLoop = false;
  
  return serverlessHandler(event, context);
};
