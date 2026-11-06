package helpers

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// fakeClient records what a command asked for and answers with canned values.
type fakeClient struct {
	input     json.RawMessage
	variable  json.RawMessage
	context   json.RawMessage
	result    json.RawMessage
	err       error
	output    json.RawMessage
	setKey    string
	setValue  json.RawMessage
	condition *bool
	tool      string
	action    string
	config    json.RawMessage
	gotKey    string
}

func (f *fakeClient) GetInput() (json.RawMessage, error) { return f.input, f.err }
func (f *fakeClient) SetOutput(data json.RawMessage) error {
	f.output = data
	return f.err
}
func (f *fakeClient) GetVariable(key string) (json.RawMessage, error) {
	f.gotKey = key
	return f.variable, f.err
}
func (f *fakeClient) SetVariable(key string, value json.RawMessage) error {
	f.setKey, f.setValue = key, value
	return f.err
}
func (f *fakeClient) SetCondition(condition bool) error {
	f.condition = &condition
	return f.err
}
func (f *fakeClient) GetContext() (json.RawMessage, error) { return f.context, f.err }
func (f *fakeClient) ExecuteToolAction(tool, action string, config json.RawMessage) (json.RawMessage, error) {
	f.tool, f.action, f.config = tool, action, config
	return f.result, f.err
}

func runCommand(t *testing.T, run func(*Env, []string) error, client *fakeClient, stdin string, args ...string) (string, error) {
	t.Helper()
	var stdout bytes.Buffer
	env := &Env{
		Stdin:     strings.NewReader(stdin),
		Stdout:    &stdout,
		NewClient: func() (Client, error) { return client, nil },
	}
	err := run(env, args)
	return stdout.String(), err
}

func TestRunInputPrintsJSONOrRaw(t *testing.T) {
	cases := []struct {
		name  string
		input json.RawMessage
		args  []string
		want  string
	}{
		{"json by default", json.RawMessage(`{"a":1}`), nil, "{\"a\":1}\n"},
		{"json null when absent", nil, nil, "null\n"},
		{"raw indents", json.RawMessage(`{"a":1}`), []string{"--raw"}, "{\n  \"a\": 1\n}\n"},
		{"raw string is bare", json.RawMessage(`"hi"`), []string{"--raw"}, "hi\n"},
		{"raw prints nothing when absent", nil, []string{"--raw"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := runCommand(t, RunInput, &fakeClient{input: tc.input}, "", tc.args...)
			if err != nil {
				t.Fatalf("RunInput failed: %v", err)
			}
			if got != tc.want {
				t.Errorf("stdout = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRunGetVariablePrintsBareValueWithRaw(t *testing.T) {
	cases := []struct {
		name  string
		value json.RawMessage
		args  []string
		want  string
	}{
		{"json by default", json.RawMessage(`"value"`), []string{"K"}, "\"value\"\n"},
		{"raw string is bare", json.RawMessage(`"value"`), []string{"--raw", "K"}, "value\n"},
		{"flag after the key", json.RawMessage(`"value"`), []string{"K", "--raw"}, "value\n"},
		{"raw unset prints nothing", nil, []string{"--raw", "K"}, ""},
		{"json unset is null", nil, []string{"K"}, "null\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := &fakeClient{variable: tc.value}
			got, err := runCommand(t, RunGetVariable, client, "", tc.args...)
			if err != nil {
				t.Fatalf("RunGetVariable failed: %v", err)
			}
			if got != tc.want {
				t.Errorf("stdout = %q, want %q", got, tc.want)
			}
			if client.gotKey != "K" {
				t.Errorf("key = %q, want K", client.gotKey)
			}
		})
	}
}

func TestRunGetVariableNeedsAKey(t *testing.T) {
	if _, err := runCommand(t, RunGetVariable, &fakeClient{}, ""); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("expected a usage error, got: %v", err)
	}
}

// Stdout stays empty on success, so a script's log matches a container's.
func TestWriteCommandsPrintNothingOnSuccess(t *testing.T) {
	cases := map[string]struct {
		run  func(*Env, []string) error
		args []string
	}{
		"output":       {RunOutput, nil},
		"setVariable":  {RunSetVariable, []string{"K", "v"}},
		"setCondition": {RunSetCondition, []string{"true"}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := runCommand(t, tc.run, &fakeClient{}, "x", tc.args...)
			if err != nil {
				t.Fatalf("command failed: %v", err)
			}
			if got != "" {
				t.Errorf("stdout = %q, want empty", got)
			}
		})
	}
}

func TestRunOutputKeepsJSONAndWrapsTheRest(t *testing.T) {
	cases := map[string]string{
		`{"b":1,"a":2}`: `{"b":1,"a":2}`,
		`42`:            `42`,
		`plain text`:    `"plain text"`,
		``:              `""`,
	}
	for stdin, want := range cases {
		client := &fakeClient{}
		if _, err := runCommand(t, RunOutput, client, stdin); err != nil {
			t.Fatalf("RunOutput(%q) failed: %v", stdin, err)
		}
		if string(client.output) != want {
			t.Errorf("RunOutput(%q) sent %s, want %s", stdin, client.output, want)
		}
	}
}

func TestRunSetVariableReadsArgumentOrStdin(t *testing.T) {
	cases := []struct {
		name  string
		args  []string
		stdin string
		want  string
	}{
		{"argument string", []string{"K", "hello"}, "", `"hello"`},
		{"argument number", []string{"K", "42"}, "", `42`},
		{"argument wins over stdin", []string{"K", "a"}, "b", `"a"`},
		{"empty argument", []string{"K", ""}, "ignored", `""`},
		{"stdin json", []string{"K"}, `{"a":1}`, `{"a":1}`},
		{"stdin text", []string{"K"}, "two words", `"two words"`},
		{"stdin null", []string{"K"}, "null", `null`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := &fakeClient{}
			if _, err := runCommand(t, RunSetVariable, client, tc.stdin, tc.args...); err != nil {
				t.Fatalf("RunSetVariable failed: %v", err)
			}
			if client.setKey != "K" || string(client.setValue) != tc.want {
				t.Errorf("sent %s=%s, want K=%s", client.setKey, client.setValue, tc.want)
			}
		})
	}
}

func TestRunSetConditionAcceptsWhatTheContainerAccepts(t *testing.T) {
	for arg, want := range map[string]bool{
		"true": true, "1": true, "yes": true, "on": true,
		"false": false, "0": false, "no": false, "off": false,
	} {
		client := &fakeClient{}
		if _, err := runCommand(t, RunSetCondition, client, "", arg); err != nil {
			t.Fatalf("RunSetCondition(%q) failed: %v", arg, err)
		}
		if client.condition == nil || *client.condition != want {
			t.Errorf("RunSetCondition(%q) sent %v, want %v", arg, client.condition, want)
		}
	}
}

func TestRunSetConditionRejectsAnythingElse(t *testing.T) {
	for _, args := range [][]string{{"maybe"}, {"TRUE"}, {""}, {}, {"true", "extra"}} {
		client := &fakeClient{}
		if _, err := runCommand(t, RunSetCondition, client, "", args...); err == nil {
			t.Errorf("RunSetCondition(%q): expected an error", args)
		}
		if client.condition != nil {
			t.Errorf("RunSetCondition(%q) reached the client", args)
		}
	}
}

func TestRunEventPrintsWholeContextOrOneField(t *testing.T) {
	context := json.RawMessage(`{"eventId":"7","event":{"name":"<Demo>"},"no":false}`)
	cases := []struct {
		name    string
		context json.RawMessage
		args    []string
		want    string
	}{
		{"whole context", context, nil, "{\n  \"eventId\": \"7\",\n  \"event\": {\n    \"name\": \"<Demo>\"\n  },\n  \"no\": false\n}\n"},
		{"empty object when absent", nil, nil, "{}\n"},
		{"top-level field", context, []string{"--field", "eventId"}, "7\n"},
		{"nested field", context, []string{"--field", "event.name"}, "<Demo>\n"},
		{"false prints", context, []string{"--field", "no"}, "false\n"},
		{"missing field prints nothing", context, []string{"--field", "nope"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := runCommand(t, RunEvent, &fakeClient{context: tc.context}, "", tc.args...)
			if err != nil {
				t.Fatalf("RunEvent failed: %v", err)
			}
			if got != tc.want {
				t.Errorf("stdout = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRunEventRejectsBadArguments(t *testing.T) {
	for _, args := range [][]string{{"--field"}, {"name"}, {"--field", "a", "b"}} {
		if _, err := runCommand(t, RunEvent, &fakeClient{}, "", args...); err == nil {
			t.Errorf("RunEvent(%q): expected an error", args)
		}
	}
}

func TestRunToolActionBuildsTheContainerConfig(t *testing.T) {
	cases := []struct {
		name       string
		args       []string
		stdin      string
		wantTool   string
		wantConfig map[string]interface{}
	}{
		{
			name: "email", args: []string{"email", "a@x.io, b@x.io", "Hi", "Body"}, wantTool: "email",
			wantConfig: map[string]interface{}{
				"to": []interface{}{"a@x.io", "b@x.io"}, "subject": "Hi", "body": "Body",
			},
		},
		{
			name:     "email options",
			args:     []string{"email", "a@x.io", "Hi", "Body", "--cc", "c@x.io,d@x.io", "--bcc", "e@x.io", "--html", "--unknown"},
			wantTool: "email",
			wantConfig: map[string]interface{}{
				"to": []interface{}{"a@x.io"}, "subject": "Hi", "body": "Body",
				"cc": []interface{}{"c@x.io", "d@x.io"}, "bcc": []interface{}{"e@x.io"}, "html": true,
			},
		},
		{
			name: "slack", args: []string{"slack", "#ops", "hello"}, wantTool: "slack",
			wantConfig: map[string]interface{}{"channel": "#ops", "text": "hello"},
		},
		{
			name:     "slack options",
			args:     []string{"slack", "#ops", "hello", "--username", "bot", "--icon-emoji", ":x:", "--icon-url", "http://i"},
			wantTool: "slack",
			wantConfig: map[string]interface{}{
				"channel": "#ops", "text": "hello", "username": "bot", "icon_emoji": ":x:", "icon_url": "http://i",
			},
		},
		{
			name: "discord", args: []string{"discord", "123", "hello"}, wantTool: "discord",
			wantConfig: map[string]interface{}{"channelId": "123", "content": "hello"},
		},
		{
			name: "discord embed", args: []string{"discord", "123", "hello", "--embed", `{"title":"t"}`}, wantTool: "discord",
			wantConfig: map[string]interface{}{
				"channelId": "123", "content": "hello", "embeds": []interface{}{map[string]interface{}{"title": "t"}},
			},
		},
		{
			name: "execute", args: []string{"execute", "sql", "send_message"}, stdin: `{"query":"select 1"}`, wantTool: "sql",
			wantConfig: map[string]interface{}{"query": "select 1"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := &fakeClient{}
			if _, err := runCommand(t, RunToolAction, client, tc.stdin, tc.args...); err != nil {
				t.Fatalf("RunToolAction failed: %v", err)
			}
			if client.tool != tc.wantTool || client.action != "send_message" {
				t.Errorf("tool/action = %s/%s", client.tool, client.action)
			}
			var got map[string]interface{}
			if err := json.Unmarshal(client.config, &got); err != nil {
				t.Fatalf("config is not JSON: %v (%s)", err, client.config)
			}
			if !reflect.DeepEqual(got, tc.wantConfig) {
				t.Errorf("config = %#v, want %#v", got, tc.wantConfig)
			}
		})
	}
}

func TestRunToolActionPrintsResult(t *testing.T) {
	got, err := runCommand(t, RunToolAction, &fakeClient{result: json.RawMessage(`{"sent":true}`)}, "{}", "execute", "email", "send_message")
	if err != nil {
		t.Fatalf("RunToolAction failed: %v", err)
	}
	if got != "{\n  \"sent\": true\n}\n" {
		t.Errorf("stdout = %q", got)
	}

	got, err = runCommand(t, RunToolAction, &fakeClient{}, "{}", "execute", "email", "send_message")
	if err != nil {
		t.Fatalf("RunToolAction failed: %v", err)
	}
	if got != "" {
		t.Errorf("no result: stdout = %q, want empty", got)
	}
}

func TestRunToolActionRejectsBadArguments(t *testing.T) {
	cases := []struct {
		stdin string
		args  []string
	}{
		{"", nil},
		{"", []string{"nonsense"}},
		{"not json", []string{"execute", "email", "send_message"}},
		{"{}", []string{"execute", "email"}},
		{"", []string{"email", "a@x.io", "subject only"}},
		{"", []string{"email", "a", "b", "c", "--cc"}},
		{"", []string{"slack", "#ops"}},
		{"", []string{"slack", "#ops", "hi", "--username"}},
		{"", []string{"discord", "123"}},
		{"", []string{"discord", "123", "hi", "--embed"}},
		{"", []string{"discord", "123", "hi", "--embed", "not json"}},
	}
	for _, tc := range cases {
		client := &fakeClient{}
		if _, err := runCommand(t, RunToolAction, client, tc.stdin, tc.args...); err == nil {
			t.Errorf("RunToolAction(%q): expected an error", tc.args)
		}
		if client.tool != "" {
			t.Errorf("RunToolAction(%q) reached the client", tc.args)
		}
	}
}

func TestCommandsSurfaceClientErrors(t *testing.T) {
	boom := errors.New("boom")
	cases := map[string]struct {
		run  func(*Env, []string) error
		args []string
	}{
		"input":        {RunInput, nil},
		"output":       {RunOutput, nil},
		"getVariable":  {RunGetVariable, []string{"K"}},
		"setVariable":  {RunSetVariable, []string{"K", "v"}},
		"setCondition": {RunSetCondition, []string{"true"}},
		"event":        {RunEvent, nil},
		"toolAction":   {RunToolAction, []string{"slack", "#x", "y"}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := runCommand(t, tc.run, &fakeClient{err: boom}, "", tc.args...)
			if !errors.Is(err, boom) {
				t.Errorf("err = %v, want it to wrap boom", err)
			}
		})
	}
}

func TestClientFromConfigPicksTheMode(t *testing.T) {
	setHelperEnv(t, map[string]string{"CRONIUM_HELPER_MODE": "api", "CRONIUM_API_ENDPOINT": "http://x", "CRONIUM_API_TOKEN": "t", "CRONIUM_EXECUTION_ID": "e"})
	client, err := clientFromConfig()
	if err != nil {
		t.Fatalf("clientFromConfig failed: %v", err)
	}
	if _, ok := client.(*APIClient); !ok {
		t.Errorf("api mode gave %T", client)
	}

	setHelperEnv(t, map[string]string{"CRONIUM_HELPER_MODE": "bundled"})
	client, err = clientFromConfig()
	if err != nil {
		t.Fatalf("clientFromConfig failed: %v", err)
	}
	if _, ok := client.(*BundledClient); !ok {
		t.Errorf("bundled mode gave %T", client)
	}

	setHelperEnv(t, map[string]string{"CRONIUM_HELPER_MODE": "sideways"})
	if _, err := clientFromConfig(); err == nil || !strings.Contains(err.Error(), "unknown mode") {
		t.Errorf("expected an unknown mode error, got: %v", err)
	}
}
