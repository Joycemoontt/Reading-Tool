import asyncio
import json
import os
import time

from fastapi import HTTPException
from google import genai
from google.genai import types

_lock = asyncio.Lock()
_last_call = 0.0


def model_for_task(task: str) -> str | None:
    names = {"brief": "GEMINI_MODEL_BRIEF", "deep": "GEMINI_MODEL_REASONING",
             "ask": "GEMINI_MODEL_REASONING", "vision": "GEMINI_MODEL_VISION"}
    return os.getenv(names.get(task, "")) or os.getenv("GEMINI_MODEL")


async def generate(prompt: str, json_mode: bool = False, image: bytes | None = None,
                   model_override: str | None = None) -> str:
    global _last_call
    key = os.getenv("GEMINI_API_KEY")
    model = model_override or os.getenv("GEMINI_MODEL")
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
                    contents=[prompt, types.Part.from_bytes(data=image, mime_type="image/png")] if image else prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        response_mime_type="application/json" if json_mode else "text/plain",
                    ),
                )
            response = await asyncio.wait_for(asyncio.to_thread(call), timeout=60)
            if not response.text:
                raise HTTPException(502, "Gemini 没有返回文本")
            return response.text
        except HTTPException:
            raise
        except TimeoutError as exc:
            raise HTTPException(504, "Gemini 响应超时，请重试") from exc
        except Exception as exc:
            message = str(exc).lower()
            if "429" in message or "quota" in message:
                raise HTTPException(429, "Gemini 免费额度或速率限制已达到，请稍后重试") from exc
            if "401" in message or "403" in message or "api key" in message:
                raise HTTPException(502, "Gemini 认证失败，请检查后端 API Key") from exc
            if "404" in message or "model" in message and "not found" in message:
                raise HTTPException(502, "Gemini 模型不可用，请检查后端 GEMINI_MODEL") from exc
            raise HTTPException(502, "Gemini 请求失败，请检查网络连接并稍后重试") from exc


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
