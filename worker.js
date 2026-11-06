
const MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...headers
    }
  });
}

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map(value => value.trim());

  if (allowed.includes("*")) return "*";
  if (allowed.includes(origin)) return origin;
  return allowed[0] || "null";
}

async function authenticate(request, env) {
  const authorization = request.headers.get("Authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return false;
  }

  const token = authorization.slice(7);

  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": env.SUPABASE_ANON_KEY
        }
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = cors(origin, env);

    const headers = {
      ...corsHeaders,
      "Access-Control-Allow-Origin": allowedOrigin,
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        status: "online",
        service: "NEXUS AI 2.0",
        model: MODEL
      }, 200, headers);
    }

    if (url.pathname !== "/chat") {
      return json({ error: "Endpoint não encontrado." }, 404, headers);
    }

    if (request.method !== "POST") {
      return json({ error: "Método não permitido." }, 405, headers);
    }

    if (!env.AI || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json({
        error: "Configuração do servidor incompleta."
      }, 500, headers);
    }

    const authenticated = await authenticate(request, env);

    if (!authenticated) {
      return json({
        error: "Sessão inválida. Faça login novamente."
      }, 401, headers);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON inválido." }, 400, headers);
    }

    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({
        error: "Envie pelo menos uma mensagem."
      }, 400, headers);
    }

    const validMessages = messages
      .filter(message =>
        message &&
        ["system", "user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 30000)
      }));

    if (validMessages.length === 0) {
      return json({ error: "Mensagens inválidas." }, 400, headers);
    }

    const maxTokens = Math.min(
      Math.max(Number(body.max_tokens) || 2048, 1),
      8192
    );

    const temperature = Math.min(
      Math.max(Number(body.temperature ?? 0.7), 0),
      2
    );

    try {
      const stream = await env.AI.run(MODEL, {
        messages: validMessages,
        stream: true,
        max_tokens: maxTokens,
        temperature
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive"
        }
      });

    } catch (error) {
      return json({
        error: "Erro ao executar o modelo de IA.",
        details: error.message
      }, 500, headers);
    }
  }
};
