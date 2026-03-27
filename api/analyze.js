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

function tokenizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

function unique(arr) {
  return [...new Set(arr)];
}

function buildLocalAnalysis(resumeText, jobDesc = "") {
  const resumeTokens = unique(tokenizeText(resumeText));
  const jobTokens = unique(tokenizeText(jobDesc));
  const hasJobDesc = Boolean(jobDesc && jobDesc.trim());

  const skillDictionary = [
    "javascript", "typescript", "node", "express", "react", "angular", "vue", "python", "java", "c++",
    "sql", "postgresql", "mysql", "mongodb", "redis", "aws", "azure", "docker", "kubernetes", "git",
    "rest", "api", "microservices", "testing", "ci", "cd", "linux", "communication", "leadership"
  ];

  const resumeSkills = skillDictionary.filter((skill) => resumeTokens.some((t) => t.includes(skill)));
  const matchedSkills = hasJobDesc
    ? resumeSkills.filter((skill) => jobTokens.some((t) => t.includes(skill)))
    : resumeSkills;
  const missingSkills = hasJobDesc
    ? skillDictionary.filter((skill) => jobTokens.some((t) => t.includes(skill)) && !resumeSkills.includes(skill)).slice(0, 8)
    : ["quantified impact", "clear summary", "project outcomes"].filter((s) => !resumeText.toLowerCase().includes(s.split(" ")[0]));

  const scoreBase = 45;
  const scoreFromSkills = Math.min(35, matchedSkills.length * 6);
  const scoreFromContent = Math.min(20, Math.floor(String(resumeText || "").length / 220));
  const overallScore = Math.max(35, Math.min(95, scoreBase + scoreFromSkills + scoreFromContent - (missingSkills.length > 4 ? 8 : 0)));

  const recommendation = hasJobDesc
    ? overallScore >= 78
      ? "Strong Fit"
      : overallScore >= 62
        ? "Potential Fit"
        : "Weak Fit"
    : overallScore >= 78
      ? "Excellent"
      : overallScore >= 62
        ? "Good"
        : "Needs Improvement";

  const improvementSuggestions = [
    "Add measurable outcomes (for example, performance gains, revenue impact, or time savings).",
    "Tailor the summary and skills section to the target role keywords.",
    "Use consistent action verbs and concise bullet points for each achievement.",
    "Highlight recent projects with tools, ownership scope, and business impact."
  ];

  const strengths = [
    matchedSkills.length ? `Relevant skill coverage: ${matchedSkills.slice(0, 6).join(", ")}` : "Contains foundational technical or professional skills.",
    "Resume structure is parseable for ATS and recruiter review.",
    "Content provides enough context for an initial screening pass."
  ];

  const gaps = [
    missingSkills.length ? `Potential gaps for this role: ${missingSkills.slice(0, 5).join(", ")}` : "Role-specific missing skills are limited.",
    "Could use stronger quantified impact statements.",
    "Some sections may benefit from tighter wording and prioritization."
  ];

  const interviewQuestions = [
    "Can you describe one project where you delivered measurable business impact?",
    "Which tools and technologies are you most confident using in production?",
    "How do you approach debugging or incident handling under tight timelines?",
    "What would be your first 30-day plan for this role?"
  ];

  const summary = hasJobDesc
    ? `Local fallback analysis completed. Candidate appears to be a ${recommendation.toLowerCase()} based on skill overlap and resume quality.`
    : `Local fallback analysis completed. Resume shows ${recommendation.toLowerCase()} overall quality with clear opportunities to improve impact and targeting.`;

  return {
    overallScore,
    recommendation,
    matchedSkills,
    missingSkills,
    improvementSuggestions,
    strengths,
    gaps,
    interviewQuestions,
    summary
  };
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

  const { model, resumeText, jobDesc } = req.body || {};
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!resumeText) {
    return res.status(400).json({ error: "resumeText is required" });
  }

  if (!apiKey) {
    const localResult = buildLocalAnalysis(resumeText, jobDesc);
    return res.json({
      content: JSON.stringify(localResult),
      mode: "local-fallback",
      reason: "OPENROUTER_API_KEY missing"
    });
  }

  const selectedModel = (typeof model === "string" && model.trim())
    ? model.trim()
    : (process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini");

  const hasJobDesc = typeof jobDesc === "string" && jobDesc.trim().length > 0;

  const systemPrompt = hasJobDesc
    ? `You are an ATS-style resume screening assistant.
Return ONLY valid JSON with this exact structure:
{
  "overallScore": number,
  "recommendation": "Strong Fit" | "Potential Fit" | "Weak Fit",
  "matchedSkills": string[],
  "missingSkills": string[],
  "improvementSuggestions": string[],
  "strengths": string[],
  "gaps": string[],
  "interviewQuestions": string[],
  "summary": string
}

Scoring rules:
- overallScore is 0-100
- keep concise and practical
- avoid markdown, return JSON only`
    : `You are an expert resume reviewer.
Return ONLY valid JSON with this exact structure:
{
  "overallScore": number,
  "recommendation": "Excellent" | "Good" | "Needs Improvement",
  "matchedSkills": string[],
  "missingSkills": string[],
  "improvementSuggestions": string[],
  "strengths": string[],
  "gaps": string[],
  "interviewQuestions": string[],
  "summary": string
}

Guidelines for resume-only mode:
- overallScore is 0-100 based on resume quality, clarity, and impact
- matchedSkills: strongest skills visible in the resume
- missingSkills: important skills/details often missing in resumes (quantified impact, tools, certifications, etc.)
- improvementSuggestions: actionable bullet points to improve this resume content and impact
- interviewQuestions: targeted questions to validate unclear areas in this candidate profile
- keep concise and practical
- avoid markdown, return JSON only`;

  const userPrompt = hasJobDesc
    ? `Job Description:\n${jobDesc}\n\nResume:\n${resumeText}`
    : `Provide detailed feedback for this resume:\n\n${resumeText}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://resume-analyser.vercel.app",
        "X-Title": "AI Resume Screening System"
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 1200
      })
    });

    const responseText = await response.text();
    const data = safeJsonParse(responseText);

    if (!response.ok) {
      const message = data?.error?.message
        || (responseText && responseText.trim())
        || `OpenRouter request failed with status ${response.status}`;

      if (shouldUseLocalFallback(response.status, message)) {
        const localResult = buildLocalAnalysis(resumeText, jobDesc);
        return res.json({
          content: JSON.stringify(localResult),
          mode: "local-fallback",
          reason: message
        });
      }

      return res.status(response.status).json({ error: message, details: data || responseText || null });
    }

    if (!data) {
      return res.status(502).json({ error: "OpenRouter returned empty or non-JSON response" });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "No content returned from OpenRouter" });
    }

    res.json({ content, raw: data });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
