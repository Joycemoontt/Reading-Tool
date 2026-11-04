import asyncio
import json
import os
import time

from fastapi import HTTPException
from google import genai
from google.genai import types

_lock = asyncio.Lock()
_last_call = 0.0


async def generate(prompt: str, json_mode: bool = False) -> str:
    global _last_call
    key = os.getenv("GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL")
    if not key or not model:
        raise HTTPException(503, "请先在后端环境变量中配置 GEMINI_API_KEY 和 GEMINI_MODEL")
    async with _lock:
        wait = max(0, 1.5 - (time.monotonic() - _last_call))
        if wait:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()
        try:
            def call():
                client = genai.Client(api_key=key)
                return client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        response_mime_type="application/json" if json_mode else "text/plain",
                    ),
                )
            response = await asyncio.to_thread(call)
            if not response.text:
                raise HTTPException(502, "Gemini 没有返回文本")
            return response.text
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc)
            if "429" in message or "quota" in message.lower():
                raise HTTPException(429, "Gemini 免费额度或速率限制已达到，请稍后重试") from exc
            raise HTTPException(502, f"Gemini 请求失败：{message[:180]}") from exc


async def translate_batch(items: list[dict]) -> dict[str, str]:
    prompt = (
        "将下列科研论文段落准确翻译为简体中文。保持每个 id 一一对应，保留公式、引用、图表编号和科研结论。"
        "只返回 JSON 对象，键为 id，值为翻译。\n" + json.dumps(items, ensure_ascii=False)
    )
    try:
        data = json.loads(await generate(prompt, json_mode=True))
        return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}
    except json.JSONDecodeError as exc:
        raise HTTPException(502, "Gemini 翻译结果格式无效，请重试") from exc
