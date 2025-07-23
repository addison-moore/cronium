"""
Cronium Runtime SDK for Python

This SDK provides runtime helper functions for scripts executing within the Cronium
containerized environment. It communicates with the Runtime API service to manage
variables, input/output data, and tool actions.
"""

import os
import json
import time
import asyncio
from typing import Any, Dict, Optional, Union, AsyncIterator
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, quote
import ssl
import logging

# Set up logging
logger = logging.getLogger("cronium")
logger.setLevel(logging.DEBUG if os.environ.get("CRONIUM_DEBUG") else logging.INFO)


class CroniumError(Exception):
    """Base exception for Cronium SDK errors"""
    pass


class CroniumAPIError(CroniumError):
    """API request failed"""
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"API Error ({status_code}): {message}")


class CroniumTimeoutError(CroniumError):
    """Request timed out"""
    pass


class Cronium:
    """
    Main class for interacting with the Cronium Runtime API.
    
    This class is instantiated automatically when the module is imported,
    and provides methods for all runtime operations.
    """
    
    def __init__(self):
        """Initialize the Cronium client from environment variables."""
        self.api_url = os.environ.get("CRONIUM_RUNTIME_API", "http://localhost:8081")
        self.token = os.environ.get("CRONIUM_EXECUTION_TOKEN")
        self.execution_id = os.environ.get("CRONIUM_EXECUTION_ID")
        
        if not self.token:
            raise CroniumError("CRONIUM_EXECUTION_TOKEN environment variable not set")
        if not self.execution_id:
            raise CroniumError("CRONIUM_EXECUTION_ID environment variable not set")
        
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        # Retry configuration
        self.max_retries = 3
        self.retry_delay = 1.0  # seconds
        self.timeout = 30  # seconds
        
        # SSL context for HTTPS
        self.ssl_context = ssl.create_default_context()
    
    def _make_request(self, method: str, path: str, data: Any = None) -> Any:
        """
        Make an HTTP request to the Runtime API with retry logic.
        
        Args:
            method: HTTP method (GET, POST, PUT, etc.)
            path: API endpoint path
            data: Optional request body data
            
        Returns:
            Parsed JSON response
            
        Raises:
            CroniumAPIError: If the API returns an error
            CroniumTimeoutError: If the request times out
        """
        url = urljoin(self.api_url, path)
        
        for attempt in range(self.max_retries):
            try:
                # Prepare request
                req_data = None
                if data is not None:
                    req_data = json.dumps(data).encode("utf-8")
                
                req = Request(url, data=req_data, headers=self.headers, method=method)
                
                # Make request with timeout
                response = urlopen(req, timeout=self.timeout, context=self.ssl_context)
                
                # Read and parse response
                response_data = response.read().decode("utf-8")
                if response_data:
                    result = json.loads(response_data)
                    if isinstance(result, dict) and result.get("success") is False:
                        raise CroniumAPIError(response.status, result.get("message", "Unknown error"))
                    return result
                return None
                
            except HTTPError as e:
                # Handle HTTP errors
                error_body = e.read().decode("utf-8")
                try:
                    error_data = json.loads(error_body)
                    message = error_data.get("message", str(e))
                except json.JSONDecodeError:
                    message = error_body or str(e)
                
                if e.code >= 500 and attempt < self.max_retries - 1:
                    # Retry on server errors
                    time.sleep(self.retry_delay * (2 ** attempt))  # Exponential backoff
                    continue
                    
                raise CroniumAPIError(e.code, message)
                
            except URLError as e:
                if "timed out" in str(e) and attempt < self.max_retries - 1:
                    # Retry on timeout
                    time.sleep(self.retry_delay * (2 ** attempt))
                    continue
                raise CroniumTimeoutError(f"Request timed out: {e}")
            
            except Exception as e:
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay * (2 ** attempt))
                    continue
                raise CroniumError(f"Request failed: {e}")
        
        raise CroniumError("Max retries exceeded")
    
    def input(self) -> Any:
        """
        Get input data for this execution.
        
        Returns:
            The input data passed to this execution, or None if no input.
        """
        result = self._make_request("GET", f"/executions/{self.execution_id}/input")
        return result.get("data") if result else None
    
    def output(self, data: Any) -> None:
        """
        Set output data for this execution.
        
        Args:
            data: The output data to store. Can be any JSON-serializable value.
        """
        self._make_request("POST", f"/executions/{self.execution_id}/output", {"data": data})
    
    def get_variable(self, key: str) -> Any:
        """
        Get a variable value.
        
        Args:
            key: The variable key to retrieve
            
        Returns:
            The variable value, or None if not set
        """
        try:
            result = self._make_request("GET", f"/executions/{self.execution_id}/variables/{quote(key)}")
            return result.get("data", {}).get("value") if result else None
        except CroniumAPIError as e:
            if e.status_code == 404:
                return None
            raise
    
    def set_variable(self, key: str, value: Any) -> None:
        """
        Set a variable value.
        
        Args:
            key: The variable key to set
            value: The value to store. Can be any JSON-serializable value.
        """
        self._make_request("PUT", f"/executions/{self.execution_id}/variables/{quote(key)}", {"value": value})
    
    def set_condition(self, condition: bool) -> None:
        """
        Set the workflow condition for this execution.
        
        Args:
            condition: True or False to control conditional workflow paths
        """
        self._make_request("POST", f"/executions/{self.execution_id}/condition", {"condition": condition})
    
    def event(self) -> Dict[str, Any]:
        """
        Get the current event context.
        
        Returns:
            Dictionary containing event metadata including:
            - id: Event ID
            - name: Event name
            - type: Event type
            - userId: User who created the event
            - executionId: Current execution ID
        """
        result = self._make_request("GET", f"/executions/{self.execution_id}/context")
        return result.get("data", {}) if result else {}
    
    def execute_tool_action(self, tool: str, action: str, config: Dict[str, Any]) -> Any:
        """
        Execute a tool action.
        
        Args:
            tool: The tool name (e.g., "slack", "email", "discord")
            action: The action to perform (e.g., "send_message")
            config: Tool-specific configuration
            
        Returns:
            The result from the tool action
        """
        payload = {
            "tool": tool,
            "action": action,
            "config": config
        }
        result = self._make_request("POST", "/tool-actions/execute", payload)
        return result.get("data") if result else None
    
    # Convenience methods for common tool actions
    
    def send_email(self, to: Union[str, list], subject: str, body: str, **kwargs) -> Any:
        """
        Send an email using the email tool.
        
        Args:
            to: Email recipient(s)
            subject: Email subject
            body: Email body (HTML supported)
            **kwargs: Additional email options (cc, bcc, attachments, etc.)
        """
        config = {
            "to": to if isinstance(to, list) else [to],
            "subject": subject,
            "body": body,
            **kwargs
        }
        return self.execute_tool_action("email", "send_message", config)
    
    def send_slack_message(self, channel: str, text: str, **kwargs) -> Any:
        """
        Send a Slack message.
        
        Args:
            channel: Slack channel or user ID
            text: Message text
            **kwargs: Additional Slack options (attachments, blocks, etc.)
        """
        config = {
            "channel": channel,
            "text": text,
            **kwargs
        }
        return self.execute_tool_action("slack", "send_message", config)
    
    def send_discord_message(self, channel_id: str, content: str, **kwargs) -> Any:
        """
        Send a Discord message.
        
        Args:
            channel_id: Discord channel ID
            content: Message content
            **kwargs: Additional Discord options (embeds, etc.)
        """
        config = {
            "channelId": channel_id,
            "content": content,
            **kwargs
        }
        return self.execute_tool_action("discord", "send_message", config)


# Async support for advanced use cases
class AsyncCronium(Cronium):
    """
    Async version of the Cronium client for use with asyncio.
    
    This provides the same interface as Cronium but with async/await support
    for better performance in async applications.
    """
    
    def __init__(self):
        super().__init__()
        self._session = None
    
    async def _ensure_session(self):
        """Ensure aiohttp session is created."""
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession(
                headers=self.headers,
                timeout=aiohttp.ClientTimeout(total=self.timeout)
            )
    
    async def _make_request(self, method: str, path: str, data: Any = None) -> Any:
        """Make an async HTTP request."""
        await self._ensure_session()
        url = urljoin(self.api_url, path)
        
        for attempt in range(self.max_retries):
            try:
                async with self._session.request(method, url, json=data) as response:
                    if response.status >= 500 and attempt < self.max_retries - 1:
                        await asyncio.sleep(self.retry_delay * (2 ** attempt))
                        continue
                    
                    response_data = await response.json()
                    
                    if response.status >= 400:
                        message = response_data.get("message", "Unknown error")
                        raise CroniumAPIError(response.status, message)
                    
                    if isinstance(response_data, dict) and response_data.get("success") is False:
                        raise CroniumAPIError(response.status, response_data.get("message", "Unknown error"))
                    
                    return response_data
                    
            except asyncio.TimeoutError:
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    continue
                raise CroniumTimeoutError("Request timed out")
            
            except Exception as e:
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    continue
                raise CroniumError(f"Request failed: {e}")
        
        raise CroniumError("Max retries exceeded")
    
    async def close(self):
        """Close the async session."""
        if self._session:
            await self._session.close()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    # Async versions of all methods
    async def input(self) -> Any:
        result = await self._make_request("GET", f"/executions/{self.execution_id}/input")
        return result.get("data") if result else None
    
    async def output(self, data: Any) -> None:
        await self._make_request("POST", f"/executions/{self.execution_id}/output", {"data": data})
    
    async def get_variable(self, key: str) -> Any:
        try:
            result = await self._make_request("GET", f"/executions/{self.execution_id}/variables/{quote(key)}")
            return result.get("data", {}).get("value") if result else None
        except CroniumAPIError as e:
            if e.status_code == 404:
                return None
            raise
    
    async def set_variable(self, key: str, value: Any) -> None:
        await self._make_request("PUT", f"/executions/{self.execution_id}/variables/{quote(key)}", {"value": value})
    
    async def set_condition(self, condition: bool) -> None:
        await self._make_request("POST", f"/executions/{self.execution_id}/condition", {"condition": condition})
    
    async def event(self) -> Dict[str, Any]:
        result = await self._make_request("GET", f"/executions/{self.execution_id}/context")
        return result.get("data", {}) if result else {}
    
    async def execute_tool_action(self, tool: str, action: str, config: Dict[str, Any]) -> Any:
        payload = {
            "tool": tool,
            "action": action,
            "config": config
        }
        result = await self._make_request("POST", "/tool-actions/execute", payload)
        return result.get("data") if result else None
    
    async def stream_input(self) -> AsyncIterator[Any]:
        """
        Stream input data in chunks (future implementation).
        
        Yields:
            Chunks of input data as they become available
        """
        # TODO: Implement streaming support when backend supports it
        data = await self.input()
        if data:
            yield data
    
    async def stream_output(self, data_iterator: AsyncIterator[Any]) -> None:
        """
        Stream output data in chunks (future implementation).
        
        Args:
            data_iterator: Async iterator yielding data chunks
        """
        # TODO: Implement streaming support when backend supports it
        chunks = []
        async for chunk in data_iterator:
            chunks.append(chunk)
        await self.output(chunks)


# Create global instance
cronium = Cronium()

# For backward compatibility and convenience
input = cronium.input
output = cronium.output
get_variable = cronium.get_variable
set_variable = cronium.set_variable
set_condition = cronium.set_condition
event = cronium.event
execute_tool_action = cronium.execute_tool_action
send_email = cronium.send_email
send_slack_message = cronium.send_slack_message
send_discord_message = cronium.send_discord_message