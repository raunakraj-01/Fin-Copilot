import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  console.log(`Testing Gemini Copilot response with model: ${model}...`);
  const prompt = `You are the trusted Virtual CFO for an Indian MSME. A business owner asks: "I have an order worth 50000 but I am in debt of 30000, what if payment is delayed? Will my company stop?" Provide direct, human, and complete advice.`;
  const res = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { temperature: 0.5, maxOutputTokens: 3500 }
  });
  console.log('\n--- Model Output ---');
  console.log(res.text);
  console.log('Finish Reason:', res.candidates?.[0]?.finishReason);
}

main().catch(console.error);
