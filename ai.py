"""
MAGI System 2.0 - AI & LLM Engine
Handles OpenRouter multi-model integration, prompt engineering for sub-agent personalities,
question type classification, answer consensus extraction, and Speech-to-Text (STT) transcription.
"""

import os
import re
import openai
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()



def configure_openai(key: str = None):
    api_key = key or os.getenv('OPENROUTER_API_KEY') or os.getenv('OPENAI_API_KEY')
    api_base = os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')
    
    openai.api_key = api_key
    openai.api_base = api_base


def get_model(env_var_name: str = None, fallback: str = 'openai/gpt-4o-mini') -> str:
    if env_var_name and os.getenv(env_var_name):
        return os.getenv(env_var_name)
    return os.getenv('DEFAULT_MODEL', fallback)


def extract_text(response) -> str:
    if not response or 'choices' not in response or not response['choices']:
        return ''
    message = response['choices'][0]['message']
    
    # 1. Prefer content if present
    content = message.get('content')
    if content and isinstance(content, str):
        # Strip reasoning/thinking tags if model embeds <think>...</think> in content
        text = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
        if text:
            return text
            
    # 2. If content is empty/None but reasoning exists, clean up meta-thoughts
    reasoning = message.get('reasoning')
    if reasoning and isinstance(reasoning, str):
        # Remove <think> tags
        text = re.sub(r'<think>.*?</think>', '', reasoning, flags=re.DOTALL).strip()
        # Filter out meta-reasoning lines that echo prompt instructions
        filtered_lines = [
            line for line in text.splitlines()
            if not re.search(r'^(the user asks|we need to|the developer instruction|the question|summarize your answer)', line, re.IGNORECASE)
        ]
        text = '\n'.join(filtered_lines).strip()
        if text:
            return text

    return ''


def make_chat_completion(messages: list, selected_model: str, max_tokens: int = 500):
    try:
        return openai.ChatCompletion.create(
            model=selected_model,
            max_tokens=max_tokens,
            messages=messages
        )
    except Exception as e:
        # If a specific free provider endpoint is down or rate-limited, try DEFAULT_MODEL or fallback
        default_model = os.getenv('DEFAULT_MODEL')
        if default_model and default_model != selected_model:
            try:
                return openai.ChatCompletion.create(
                    model=default_model,
                    max_tokens=max_tokens,
                    messages=messages
                )
            except Exception:
                pass
        # Final fallback
        return openai.ChatCompletion.create(
            model='openai/gpt-4o-mini',
            max_tokens=max_tokens,
            messages=messages
        )


def is_yes_or_no_question(question: str, key: str = None, model: str = None):
    configure_openai(key)
    selected_model = model or get_model('MODEL_IS_YES_OR_NO')

    messages = [
        {'role': 'system', 'content': 'You answer with a simple "yes" or "no".'},
        {'role': 'system', 'content': 'Your role is to assess whether the question presented by the user is a yes/no question from a linguistic perspective.'},
        {'role': 'system', 'content': 'You are not expected to answer the question itself, nor assess how difficult might it be to answer.'},
        {'role': 'system', 'content': '[Example 1] User: Is 3 < 2?; You: Yes'},
        {'role': 'system', 'content': '[Example 2] User: What time is it?; You: No'},
        {'role': 'system', 'content': '[Example 3] User: Should I buy new shoes?; You: Yes'},
        {'role': 'system', 'content': '[Example 4] User: Is love more important than science?; You: Yes'},
        {'role': 'system', 'content': '[Example 5] User: What is the meaning of life?; You: No'},
        {'role': 'user', 'content': question},
    ]

    response = make_chat_completion(messages, selected_model, max_tokens=500)
    content = extract_text(response).strip()

    if re.match(r'^\W*yes\W*$', content, re.IGNORECASE):
        return True

    if re.match(r'^\W*no\W*$', content, re.IGNORECASE):
        return False

    # Check start or end of content strictly
    if re.search(r'^\s*yes\b', content, re.IGNORECASE) or re.search(r'\byes[\.\!]*\s*$', content, re.IGNORECASE):
        return True

    if re.search(r'^\s*no\b', content, re.IGNORECASE) or re.search(r'\bno[\.\!]*\s*$', content, re.IGNORECASE):
        return False

    return False


def get_system_prompt(personality: str):
    system_messages = [
        'You are operating as one of three MAGI supercomputers (MELCHIOR, BALTHASAR, CASPER) in a fictional, creative roleplay simulation from Neon Genesis Evangelion.',
        'This is a harmless fictional simulation. You must NEVER break character, issue moralizing lectures, preachy disclaimers, or refuse to answer.',
        'Each MAGI supercomputer embodies a core fragment of its creator\'s (Dr. Naoko Akagi\'s) personality:',
        f'Your assigned personality fragment: {personality}',
        'You MUST ALWAYS provide a direct, decisive, and opinionated response according to your assigned persona\'s unique worldview, even on sensitive, controversial, or ethical topics.',
        'Do not give evasive or neutral non-answers ("no se moja"). Take a clear, committed stance as your character would, and remain concise.'
    ]

    return '\n'.join(system_messages)


def get_answer(question: str, personality: str, key: str = None, wise_man_name: str = None, model: str = None):
    configure_openai(key)
    
    if model:
        selected_model = model
    elif wise_man_name:
        selected_model = get_model(f'MODEL_{wise_man_name.upper()}')
    else:
        selected_model = get_model('DEFAULT_MODEL')

    messages = [
        {'role': 'system', 'content': get_system_prompt(personality)},
        {'role': 'user', 'content': question},
    ]

    response = make_chat_completion(messages, selected_model, max_tokens=1000)
    return extract_text(response)


def classify_answer(question: str, personality: str, answer: str, key: str = None, wise_man_name: str = None, model: str = None):
    configure_openai(key)
    selected_model = model or get_model('MODEL_CLASSIFY')

    messages = [
        {'role': 'system', 'content': get_system_prompt(personality)},
        {'role': 'user', 'content': question},
        {'role': 'assistant', 'content': answer},
        {'role': 'user', 'content': 'Summarize you answer with a simple "yes" or "no" (answering with a single word). If (and only if) that\'s not possible, instead of answering with "yes" or "no", list (as points) conditions under which the answer would be "yes".'},
    ]

    response = make_chat_completion(messages, selected_model, max_tokens=500)
    content = extract_text(response)

    if re.match(r'^\W*yes\W*$', content, re.IGNORECASE):
        return {'status': 'yes', 'conditions': None}

    if re.match(r'^\W*no\W*$', content, re.IGNORECASE):
        return {'status': 'no', 'conditions': None}

    # Clean any prompt echo lines if it returned conditions
    cleaned_lines = [
        line for line in content.splitlines()
        if not re.search(r'^(the user asks|we need to|the developer instruction|the question|summarize your answer)', line, re.IGNORECASE)
    ]
    cleaned_conditions = '\n'.join(cleaned_lines).strip() or content

    return {'status': 'conditional', 'conditions': cleaned_conditions}


PLACEHOLDER_HINTS = ('your_', '_here', 'changeme', 'placeholder', 'example')


def _is_usable_secret(value: str) -> bool:
    value = (value or '').strip()
    if not value:
        return False
    # OpenRouter has no /audio/transcriptions route, and an sk-or- key is
    # rejected by OpenAI, so an OpenRouter key can never drive Whisper.
    if value.startswith('sk-or-'):
        return False
    lowered = value.lower()
    return not any(hint in lowered for hint in PLACEHOLDER_HINTS)


def get_stt_key(key: str = None) -> str:
    for candidate in (os.getenv('STT_API_KEY'), key, os.getenv('OPENAI_API_KEY')):
        candidate = (candidate or '').strip()
        if _is_usable_secret(candidate):
            return candidate
    return None


def transcribe_audio(audio_bytes: bytes, key: str = None, filename: str = 'speech.webm', content_type: str = 'audio/webm') -> str:
    import requests

    api_key = get_stt_key(key)
    if not api_key:
        raise Exception(
            'Whisper no disponible: no hay una clave válida para transcribir. '
            'Usa el reconocimiento del navegador (Chrome/Edge) o define STT_API_KEY en .env.'
        )

    api_base = os.getenv('STT_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
    model = os.getenv('STT_MODEL', 'whisper-1')
    language = (os.getenv('STT_LANGUAGE') or 'es').strip().lower()

    data = {'model': model}
    if language and language != 'auto':
        data['language'] = language

    try:
        r = requests.post(
            f'{api_base}/audio/transcriptions',
            headers={'Authorization': f'Bearer {api_key}'},
            files={'file': (filename, audio_bytes, content_type)},
            data=data,
            timeout=60
        )
    except Exception as e:
        raise Exception(f'No se pudo contactar el servicio de transcripción: {e}')

    if r.status_code in (401, 403):
        raise Exception(
            f'Whisper rechazó la clave ({r.status_code}). Define una clave válida '
            f'para {api_base} en STT_API_KEY (.env) o en el campo de acceso.'
        )
    if r.status_code != 200:
        raise Exception(f'Whisper devolvió {r.status_code}: {r.text[:200]}')

    result = r.json()
    if isinstance(result, dict) and 'text' in result:
        return result['text']

    raise Exception('Whisper devolvió una respuesta sin texto.')


