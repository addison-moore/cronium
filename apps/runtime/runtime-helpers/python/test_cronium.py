"""
Unit tests for Cronium Python SDK
"""

import os
import json
import pytest
from unittest.mock import Mock, patch, MagicMock
from urllib.error import HTTPError, URLError
import asyncio

# Set required environment variables before import
os.environ["CRONIUM_RUNTIME_API"] = "http://localhost:8081"
os.environ["CRONIUM_EXECUTION_TOKEN"] = "test-token"
os.environ["CRONIUM_EXECUTION_ID"] = "test-execution-id"

import cronium
from cronium import Cronium, AsyncCronium, CroniumError, CroniumAPIError, CroniumTimeoutError


class TestCronium:
    """Test cases for synchronous Cronium client"""
    
    def setup_method(self):
        """Reset environment for each test"""
        self.client = Cronium()
    
    @patch('cronium.urlopen')
    def test_input_success(self, mock_urlopen):
        """Test successful input retrieval"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "data": {"key": "value"}
        }).encode()
        mock_urlopen.return_value = mock_response
        
        result = self.client.input()
        assert result == {"key": "value"}
        
        # Verify request details
        request = mock_urlopen.call_args[0][0]
        assert request.get_full_url() == "http://localhost:8081/executions/test-execution-id/input"
        assert request.get_method() == "GET"
        assert request.headers["Authorization"] == "Bearer test-token"
    
    @patch('cronium.urlopen')
    def test_output_success(self, mock_urlopen):
        """Test successful output setting"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({"success": True}).encode()
        mock_urlopen.return_value = mock_response
        
        self.client.output({"result": "success"})
        
        # Verify request details
        request = mock_urlopen.call_args[0][0]
        assert request.get_full_url() == "http://localhost:8081/executions/test-execution-id/output"
        assert request.get_method() == "POST"
        assert json.loads(request.data) == {"data": {"result": "success"}}
    
    @patch('cronium.urlopen')
    def test_get_variable_success(self, mock_urlopen):
        """Test successful variable retrieval"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "data": {"key": "test_var", "value": "test_value"}
        }).encode()
        mock_urlopen.return_value = mock_response
        
        result = self.client.get_variable("test_var")
        assert result == "test_value"
    
    @patch('cronium.urlopen')
    def test_get_variable_not_found(self, mock_urlopen):
        """Test variable not found returns None"""
        mock_urlopen.side_effect = HTTPError(
            "http://localhost:8081/executions/test-execution-id/variables/missing",
            404,
            "Not Found",
            {},
            Mock(read=lambda: b'{"message": "Variable not found"}')
        )
        
        result = self.client.get_variable("missing")
        assert result is None
    
    @patch('cronium.urlopen')
    def test_set_variable_success(self, mock_urlopen):
        """Test successful variable setting"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({"success": True}).encode()
        mock_urlopen.return_value = mock_response
        
        self.client.set_variable("test_var", "test_value")
        
        # Verify request
        request = mock_urlopen.call_args[0][0]
        assert "variables/test_var" in request.get_full_url()
        assert json.loads(request.data) == {"value": "test_value"}
    
    @patch('cronium.urlopen')
    def test_set_condition_success(self, mock_urlopen):
        """Test successful condition setting"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({"success": True}).encode()
        mock_urlopen.return_value = mock_response
        
        self.client.set_condition(True)
        
        # Verify request
        request = mock_urlopen.call_args[0][0]
        assert request.get_full_url() == "http://localhost:8081/executions/test-execution-id/condition"
        assert json.loads(request.data) == {"condition": True}
    
    @patch('cronium.urlopen')
    def test_event_context_success(self, mock_urlopen):
        """Test successful event context retrieval"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "data": {
                "id": "event-123",
                "name": "Test Event",
                "type": "SCRIPT"
            }
        }).encode()
        mock_urlopen.return_value = mock_response
        
        result = self.client.event()
        assert result["id"] == "event-123"
        assert result["name"] == "Test Event"
    
    @patch('cronium.urlopen')
    def test_execute_tool_action_success(self, mock_urlopen):
        """Test successful tool action execution"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "data": {"messageId": "12345"}
        }).encode()
        mock_urlopen.return_value = mock_response
        
        result = self.client.execute_tool_action("slack", "send_message", {
            "channel": "#general",
            "text": "Hello"
        })
        assert result == {"messageId": "12345"}
    
    @patch('cronium.urlopen')
    def test_retry_on_server_error(self, mock_urlopen):
        """Test retry logic on server errors"""
        # First two calls fail with 500, third succeeds
        mock_urlopen.side_effect = [
            HTTPError("url", 500, "Server Error", {}, Mock(read=lambda: b'{"message": "Internal error"}')),
            HTTPError("url", 500, "Server Error", {}, Mock(read=lambda: b'{"message": "Internal error"}')),
            Mock(read=Mock(return_value=json.dumps({"success": True, "data": "success"}).encode()))
        ]
        
        with patch('time.sleep'):  # Skip actual sleep in tests
            result = self.client.input()
            assert result == "success"
            assert mock_urlopen.call_count == 3
    
    @patch('cronium.urlopen')
    def test_timeout_retry(self, mock_urlopen):
        """Test retry on timeout"""
        mock_urlopen.side_effect = [
            URLError("timed out"),
            Mock(read=Mock(return_value=json.dumps({"success": True, "data": "success"}).encode()))
        ]
        
        with patch('time.sleep'):
            result = self.client.input()
            assert result == "success"
            assert mock_urlopen.call_count == 2
    
    @patch('cronium.urlopen')
    def test_max_retries_exceeded(self, mock_urlopen):
        """Test max retries exceeded raises error"""
        mock_urlopen.side_effect = HTTPError(
            "url", 500, "Server Error", {},
            Mock(read=lambda: b'{"message": "Internal error"}')
        )
        
        with patch('time.sleep'):
            with pytest.raises(CroniumAPIError) as exc_info:
                self.client.input()
            assert exc_info.value.status_code == 500
    
    @patch('cronium.urlopen')
    def test_send_email_convenience(self, mock_urlopen):
        """Test send_email convenience method"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({"success": True}).encode()
        mock_urlopen.return_value = mock_response
        
        self.client.send_email(
            to="test@example.com",
            subject="Test",
            body="Hello",
            cc=["cc@example.com"]
        )
        
        # Verify request payload
        request = mock_urlopen.call_args[0][0]
        payload = json.loads(request.data)
        assert payload["tool"] == "email"
        assert payload["action"] == "send_message"
        assert payload["config"]["to"] == ["test@example.com"]
        assert payload["config"]["cc"] == ["cc@example.com"]
    
    def test_missing_token_error(self):
        """Test error when token is missing"""
        del os.environ["CRONIUM_EXECUTION_TOKEN"]
        with pytest.raises(CroniumError) as exc_info:
            Cronium()
        assert "CRONIUM_EXECUTION_TOKEN" in str(exc_info.value)
        os.environ["CRONIUM_EXECUTION_TOKEN"] = "test-token"
    
    def test_missing_execution_id_error(self):
        """Test error when execution ID is missing"""
        del os.environ["CRONIUM_EXECUTION_ID"]
        with pytest.raises(CroniumError) as exc_info:
            Cronium()
        assert "CRONIUM_EXECUTION_ID" in str(exc_info.value)
        os.environ["CRONIUM_EXECUTION_ID"] = "test-execution-id"


class TestAsyncCronium:
    """Test cases for asynchronous Cronium client"""
    
    @pytest.mark.asyncio
    async def test_async_input_success(self):
        """Test async input retrieval"""
        async with AsyncCronium() as client:
            with patch.object(client, '_session') as mock_session:
                mock_response = MagicMock()
                mock_response.status = 200
                mock_response.json = asyncio.coroutine(lambda: {
                    "success": True,
                    "data": {"key": "value"}
                })
                
                mock_session.request.return_value.__aenter__.return_value = mock_response
                
                result = await client.input()
                assert result == {"key": "value"}
    
    @pytest.mark.asyncio
    async def test_async_output_success(self):
        """Test async output setting"""
        async with AsyncCronium() as client:
            with patch.object(client, '_session') as mock_session:
                mock_response = MagicMock()
                mock_response.status = 200
                mock_response.json = asyncio.coroutine(lambda: {"success": True})
                
                mock_session.request.return_value.__aenter__.return_value = mock_response
                
                await client.output({"result": "success"})
                
                # Verify request
                mock_session.request.assert_called_once()
                args = mock_session.request.call_args
                assert args[0][0] == "POST"
                assert args[1]["json"] == {"data": {"result": "success"}}
    
    @pytest.mark.asyncio
    async def test_async_retry_on_error(self):
        """Test async retry logic"""
        async with AsyncCronium() as client:
            with patch.object(client, '_session') as mock_session:
                # First call fails, second succeeds
                responses = [
                    MagicMock(status=500, json=asyncio.coroutine(lambda: {"message": "Error"})),
                    MagicMock(status=200, json=asyncio.coroutine(lambda: {"success": True, "data": "success"}))
                ]
                
                mock_session.request.return_value.__aenter__.side_effect = responses
                
                with patch('asyncio.sleep'):
                    result = await client.input()
                    assert result == "success"
                    assert mock_session.request.call_count == 2
    
    @pytest.mark.asyncio
    async def test_stream_input_placeholder(self):
        """Test stream_input placeholder implementation"""
        async with AsyncCronium() as client:
            with patch.object(client, 'input', return_value={"data": "test"}):
                chunks = []
                async for chunk in client.stream_input():
                    chunks.append(chunk)
                assert chunks == [{"data": "test"}]
    
    @pytest.mark.asyncio
    async def test_stream_output_placeholder(self):
        """Test stream_output placeholder implementation"""
        async with AsyncCronium() as client:
            async def data_generator():
                yield {"chunk": 1}
                yield {"chunk": 2}
            
            with patch.object(client, 'output') as mock_output:
                await client.stream_output(data_generator())
                mock_output.assert_called_once_with([{"chunk": 1}, {"chunk": 2}])


class TestModuleLevelFunctions:
    """Test module-level convenience functions"""
    
    @patch('cronium.urlopen')
    def test_module_input_function(self, mock_urlopen):
        """Test module-level input function"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "data": "test_data"
        }).encode()
        mock_urlopen.return_value = mock_response
        
        import cronium
        result = cronium.input()
        assert result == "test_data"
    
    @patch('cronium.urlopen')
    def test_module_output_function(self, mock_urlopen):
        """Test module-level output function"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({"success": True}).encode()
        mock_urlopen.return_value = mock_response
        
        import cronium
        cronium.output({"test": "data"})
        assert mock_urlopen.called
    
    @patch('cronium.urlopen')
    def test_module_get_variable_function(self, mock_urlopen):
        """Test module-level get_variable function"""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            "success": True,
            "data": {"key": "var", "value": "val"}
        }).encode()
        mock_urlopen.return_value = mock_response
        
        import cronium
        result = cronium.get_variable("var")
        assert result == "val"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])