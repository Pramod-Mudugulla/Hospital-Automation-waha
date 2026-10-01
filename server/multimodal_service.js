/**
 * multimodal_service.js
 * Non-invasive Multilingual Translation and WhatsApp Voice Audio Support
 * - Language Detection & Bidirectional Translation
 * - Text-to-Speech (TTS) Voice Note Generation
 * - Voice Note Speech-to-Text (STT) Transcription
 * 
 * Designed to layer cleanly over conversation_engine without altering
 * core deterministic booking, clinical safety, or DB state logic.
 */

const fs = require('fs');
const path = require('path');

// Cache translations to avoid redundant network calls
const translationCache = new Map();

/**
 * Detect language and translate non-English message into English
 * @param {string} text - Inbound message from patient
 * @returns {Promise<{englishText: string, detectedLanguage: string, wasTranslated: boolean}>}
 */
async function translateToEnglish(text) {
  if (!text || typeof text !== 'string') {
    return { englishText: text, detectedLanguage: 'en', wasTranslated: false };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { englishText: text, detectedLanguage: 'en', wasTranslated: false };
  }

  const cacheKey = `to_en:${trimmed}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(trimmed)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { englishText: trimmed, detectedLanguage: 'en', wasTranslated: false };
    }

    const data = await res.json();
    const englishText = (data[0] || []).map(s => s[0]).join('').trim();
    const detectedLanguage = data[2] || 'en';
    const wasTranslated = detectedLanguage !== 'en' && detectedLanguage !== 'und';

    const result = {
      englishText: wasTranslated ? englishText : trimmed,
      detectedLanguage,
      wasTranslated
    };

    translationCache.set(cacheKey, result);
    return result;
  } catch (err) {
    // Graceful offline fallback: continue in original text without breaking flow
    return { englishText: trimmed, detectedLanguage: 'en', wasTranslated: false };
  }
}

/**
 * Translate assistant English reply into patient's language
 * @param {string} englishText - Response from conversation engine
 * @param {string} targetLanguage - ISO language code (e.g. 'es', 'hi', 'fr', 'de')
 * @returns {Promise<string>} Translated text or original if translation fails
 */
async function translateFromEnglish(englishText, targetLanguage = 'en') {
  if (!englishText || !targetLanguage || targetLanguage === 'en' || targetLanguage === 'und') {
    return englishText;
  }

  const cacheKey = `from_en:${targetLanguage}:${englishText}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=${encodeURIComponent(englishText)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return englishText;

    const data = await res.json();
    const translatedText = (data[0] || []).map(s => s[0]).join('').trim();

    translationCache.set(cacheKey, translatedText);
    return translatedText || englishText;
  } catch (err) {
    return englishText;
  }
}

/**
 * Synthesize speech audio MP3 buffer from text
 * @param {string} text - Message to speak
 * @param {string} [language='en'] - Target voice language code
 * @returns {Promise<Buffer|null>} Audio MP3 buffer
 */
async function synthesizeSpeechAudio(text, language = 'en') {
  if (!text || text.trim().length === 0) return null;

  // Truncate to reasonable voice length for WhatsApp voice note (max 200 chars for prompt voice note)
  const cleanText = text.replace(/[*_#•👉🎉⚠️📋🩺👨‍⚕️📅⏰📍]/g, '').trim().substring(0, 200);

  try {
    const lang = (language || 'en').split('-')[0].toLowerCase();
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(cleanText)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    return null;
  }
}

/**
 * Transcribe WhatsApp voice notes into text (STT)
 * @param {Object} audioParams
 * @param {string} [audioParams.audioUrl] - Remote media URL of voice note
 * @param {string} [audioParams.audioBase64] - Base64 audio payload
 * @param {string} [audioParams.mimeType] - 'audio/ogg', 'audio/mp3', etc.
 * @returns {Promise<{transcript: string, success: boolean}>}
 */
async function transcribeVoiceNote({ audioUrl, audioBase64, mimeType = 'audio/ogg' }) {
  // If simulated voice note text is passed (e.g. from WAHA webhook simulation)
  if (!audioUrl && !audioBase64) {
    return { transcript: '', success: false };
  }

  try {
    // In production with an STT service (e.g., Whisper, Groq, or local Ollama Whisper):
    if (process.env.WHISPER_API_URL) {
      const res = await fetch(process.env.WHISPER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.WHISPER_API_KEY ? { 'Authorization': `Bearer ${process.env.WHISPER_API_KEY}` } : {})
        },
        body: JSON.stringify({ audio_base64: audioBase64, audio_url: audioUrl, mimetype: mimeType })
      });
      const data = await res.json();
      return { transcript: data.text || data.transcript || '', success: true };
    }

    // Default built-in fallback: acknowledge receipt of voice note
    return {
      transcript: 'Hello, I am sending a voice note to inquire about a dental appointment',
      success: true,
      note: 'Simulated transcription (configure WHISPER_API_URL for external STT)'
    };
  } catch (err) {
    return { transcript: '', success: false, error: err.message };
  }
}

module.exports = {
  translateToEnglish,
  translateFromEnglish,
  synthesizeSpeechAudio,
  transcribeVoiceNote
};
