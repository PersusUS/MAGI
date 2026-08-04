"""
Unit Test Suite for MAGI System 2.0
Tests AI model configuration, text extraction, prompt generation,
consensus status logic, and STT key handling.
"""

import unittest
from unittest.mock import patch, MagicMock
import ai
from main import response_status, extention, question


class TestMagiAI(unittest.TestCase):

    def test_get_model_fallback(self):
        """Test fallback model selection when env var is not set."""
        model = ai.get_model('NON_EXISTENT_ENV_VAR', fallback='fallback/model:free')
        self.assertTrue(len(model) > 0)

    def test_get_system_prompt(self):
        """Test personality prompt generation for MAGI agents."""
        personality = "You are a scientist."
        prompt = ai.get_system_prompt(personality)
        self.assertIn("MELCHIOR, BALTHASAR, CASPER", prompt)
        self.assertIn(personality, prompt)
        self.assertIn("NEVER break character", prompt)

    def test_extract_text_cleaning(self):
        """Test extraction and stripping of <think>...</think> tags."""
        mock_response = {
            'choices': [{
                'message': {
                    'content': '<think>Internal reasoning step</think>This is the final answer.'
                }
            }]
        }
        text = ai.extract_text(mock_response)
        self.assertEqual(text, 'This is the final answer.')

    def test_extract_text_empty(self):
        """Test handling of empty API response."""
        self.assertEqual(ai.extract_text(None), '')
        self.assertEqual(ai.extract_text({}), '')
        self.assertEqual(ai.extract_text({'choices': []}), '')

    def test_stt_key_rejection_of_openrouter(self):
        """Test that sk-or- OpenRouter keys are rejected for Whisper STT."""
        # An OpenRouter key should return None if no valid Whisper key exists
        with patch.dict('os.environ', {'STT_API_KEY': '', 'OPENAI_API_KEY': ''}, clear=False):
            key = ai.get_stt_key('sk-or-v1-fakekey')
            self.assertIsNone(key)

    def test_stt_key_acceptance_of_openai_key(self):
        """Test that valid OpenAI / STT keys are accepted for Whisper."""
        key = ai.get_stt_key('sk-proj-validkey')
        self.assertEqual(key, 'sk-proj-validkey')


class TestMagiConsensusLogic(unittest.TestCase):

    def test_response_status_unanimous_yes(self):
        """Test unanimous YES consensus status (合 意)."""
        answers = [
            {'id': 1, 'status': 'yes'},
            {'id': 1, 'status': 'yes'},
            {'id': 1, 'status': 'yes'}
        ]
        status, answer_id = response_status(answers)
        self.assertEqual(status, 'yes')
        self.assertEqual(answer_id, 1)

    def test_response_status_veto_no(self):
        """Test single agent NO veto status (拒 絶)."""
        answers = [
            {'id': 1, 'status': 'yes'},
            {'id': 1, 'status': 'no'},
            {'id': 1, 'status': 'yes'}
        ]
        status, _ = response_status(answers)
        self.assertEqual(status, 'no')

    def test_response_status_conditional(self):
        """Test CONDITIONAL consensus status (状 態)."""
        answers = [
            {'id': 1, 'status': 'yes'},
            {'id': 1, 'status': 'conditional'},
            {'id': 1, 'status': 'yes'}
        ]
        status, _ = response_status(answers)
        self.assertEqual(status, 'conditional')

    def test_response_status_error(self):
        """Test ERROR priority status (誤 差)."""
        answers = [
            {'id': 1, 'status': 'yes'},
            {'id': 1, 'status': 'error'},
            {'id': 1, 'status': 'no'}
        ]
        status, _ = response_status(answers)
        self.assertEqual(status, 'error')

    def test_question_extension_code(self):
        """Test extension status code calculation."""
        q = {'id': 1, 'query': 'Is it true?'}
        annotated_yes = {'id': 1, 'is_yes_or_no_question': True}
        annotated_info = {'id': 1, 'is_yes_or_no_question': False}
        mismatch = {'id': 2, 'is_yes_or_no_question': True}

        self.assertEqual(extention(q, annotated_yes), '7312')
        self.assertEqual(extention(q, annotated_info), '3023')
        self.assertEqual(extention(q, mismatch), '????')


if __name__ == '__main__':
    unittest.main()
