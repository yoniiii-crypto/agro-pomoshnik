// Сервер-посредник «Агро-помощника» для ИИ Google Gemini (Cloudflare Worker).
//
// Зачем: ключ Gemini нельзя класть в код сайта — он публичный. Ключ хранится
// только в настройках этого сервера (секрет GEMINI_KEY), а сайт отправляет
// запрос сюда без ключа. Сервер принимает запросы только со страниц сайта,
// проверяет модель и размер запроса и пересылает его в Google.
//
// Как запустить: dash.cloudflare.com → Workers & Pages → Create → Worker →
// вставить этот файл → Deploy → Settings → Variables and Secrets → добавить
// Secret с именем GEMINI_KEY и ключом из aistudio.google.com.

const ALLOWED_ORIGINS = [
  'https://yoniiii-crypto.github.io', // сайт приложения
];
const MODEL_RE = /^gemini-[a-z0-9.\-]{1,40}$/;
const MAX_BYTES = 6 * 1024 * 1024; // до трёх сжатых фото

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '3600',
      'Vary': 'Origin',
    };
    const reply = (status, text) => new Response(JSON.stringify({ error: { code: status, message: text } }), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, 'Only POST');
    if (!allowed) return reply(403, 'Origin not allowed');
    if (!env.GEMINI_KEY) return reply(500, 'GEMINI_KEY is not set on the server');

    const model = new URL(request.url).searchParams.get('model') || 'gemini-2.5-flash';
    if (!MODEL_RE.test(model)) return reply(400, 'Bad model');

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply(413, 'Request too large');

    const upstream = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
