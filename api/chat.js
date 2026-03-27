// Helper functions
function safeJsonParse(text) {
  if (!text || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shouldUseLocalFallback(statusCode, message) {
  if (statusCode === 401 || statusCode === 429) {
    return true;
  }
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("user not found") ||
    normalized.includes("invalid api key") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication") ||
    normalized.includes("invalid auth") ||
    normalized.includes("rate-limit") ||
    normalized.includes("rate limited") ||
    normalized.includes("temporarily rate-limited") ||
    normalized.includes("provider returned error") ||
    normalized.includes("quota")
  );
}

function buildLocalChatReply(message, resumeText = "") {
  const msg = String(message || "").toLowerCase();
  const hasResume = Boolean(String(resumeText || "").trim());

  if (msg.includes("ats")) {
    return "For ATS optimization, mirror key terms from the job description, keep headings standard (Summary, Experience, Skills), and add measurable outcomes in each role bullet.";
  }

  if (msg.includes("mistake") || msg.includes("errors")) {
    return "Common resume mistakes are vague bullets, missing metrics, and too many unrelated skills. Focus each bullet on action, scope, and measurable result.";
  }

  if (hasResume) {
    return "Your resume is loaded. Prioritize role-relevant skills near the top, add two quantified achievements per recent role, and tighten summary language to target the job directly.";
  }

  return "Start with a one-line value summary, add impact-based bullets (with numbers), and align your skills section to the target role keywords. I can help refine a specific section if you paste it.";
}

// Main handler
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, resumeText, conversationHistory, model } = req.body || {};
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const selectedModel = (typeof model === "string" && model.trim())
    ? model.trim()
    : (process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini");

  if (!apiKey) {
    return res.json({
      reply: buildLocalChatReply(message, resumeText),
      mode: "local-fallback",
      reason: "OPENROUTER_API_KEY missing"
    });
  }

  const systemPrompt = `You are an expert AI Resume Assistant with deep knowledge in recruitment, HR, and career development. 
Your role is to provide helpful, accurate, and actionable feedback about resumes.

Guidelines:
- Be conversational, friendly, and professional
- Provide specific, actionable advice
- Reference the resume content when available
- Answer questions about resume best practices, ATS optimization, skill gaps, career transitions, etc.
- Keep responses concise but informative (2-4 sentences ideal, max 6 sentences)
- Use bullet points for lists when appropriate
- Be encouraging while being honest about areas for improvement`;

  const messages = [{ role: "system", content: systemPrompt }];

  // Add conversation history if provided
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    messages.push(...conversationHistory);
  }

  // Add resume context if available
  if (resumeText && typeof resumeText === "string" && resumeText.trim()) {
    messages.push({
      role: "system",
      content: `Current resume being discussed:\n\n${resumeText.substring(0, 3000)}`
    });
  }

  // Add user message
  messages.push({ role: "user", content: message });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://resume-analyser.vercel.app",
        "X-Title": "AI Resume Screening System - Chat"
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: messages,
        temperature: 0.7,
        max_tokens: 500
      })
    });

    const responseText = await response.text();
    const data = safeJsonParse(responseText);

    if (!response.ok) {
      const msgErr = data?.error?.message || responseText || `OpenRouter request failed with status ${response.status}`;
      if (shouldUseLocalFallback(response.status, msgErr)) {
        return res.json({
          reply: buildLocalChatReply(message, resumeText),
          mode: "local-fallback",
          reason: msgErr
        });
      }

      return res.status(response.status).json({ error: msgErr, details: data || responseText || null });
    }

    if (!data) {
      return res.status(502).json({ error: "OpenRouter returned empty or non-JSON response" });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "No content returned from OpenRouter" });
    }

    res.json({ reply: content, raw: data });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
