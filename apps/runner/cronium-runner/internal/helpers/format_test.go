package helpers

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestPrintValueRawMatchesJQ(t *testing.T) {
	cases := []struct {
		name string
		data json.RawMessage
		want string
	}{
		{"absent prints nothing", nil, ""},
		{"string loses its quotes", json.RawMessage(`"hello world"`), "hello world\n"},
		{"escapes in a string are decoded", json.RawMessage(`"a\nb\"c"`), "a\nb\"c\n"},
		{"html escapes in a string are decoded", json.RawMessage(`"<b>"`), "<b>\n"},
		{"empty string prints a blank line", json.RawMessage(`""`), "\n"},
		{"number stays as written", json.RawMessage(`1.10`), "1.10\n"},
		{"big number keeps its precision", json.RawMessage(`12345678901234567890`), "12345678901234567890\n"},
		{"false is not treated as absent", json.RawMessage(`false`), "false\n"},
		{"object is indented", json.RawMessage(`{"b":1,"a":[1,2]}`), "{\n  \"b\": 1,\n  \"a\": [\n    1,\n    2\n  ]\n}\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			if err := printValue(&out, tc.data, true); err != nil {
				t.Fatalf("printValue failed: %v", err)
			}
			if out.String() != tc.want {
				t.Errorf("got %q, want %q", out.String(), tc.want)
			}
		})
	}
}

func TestPrintValueJSONForTheLanguageBindings(t *testing.T) {
	cases := map[string]string{
		`"hello"`:  "\"hello\"\n",
		`{"b":1}`:  "{\"b\":1}\n",
		`42`:       "42\n",
		"\x00none": "null\n",
	}
	for data, want := range cases {
		var raw json.RawMessage
		if data != "\x00none" {
			raw = json.RawMessage(data)
		}
		var out bytes.Buffer
		if err := printValue(&out, raw, false); err != nil {
			t.Fatalf("printValue failed: %v", err)
		}
		if out.String() != want {
			t.Errorf("printValue(%q) = %q, want %q", data, out.String(), want)
		}
	}
}

func TestPrintIndented(t *testing.T) {
	cases := []struct {
		name string
		data string
		want string
	}{
		{"keeps key order", `{"z":1,"a":2}`, "{\n  \"z\": 1,\n  \"a\": 2\n}\n"},
		{"undoes html escapes", `{"k":"<b> &"}`, "{\n  \"k\": \"<b> &\"\n}\n"},
		{"keeps real escapes", `{"k":"a\"b\\c\nd"}`, "{\n  \"k\": \"a\\\"b\\\\c\\nd\"\n}\n"},
		{"keeps unicode", `{"k":"é✓"}`, "{\n  \"k\": \"é✓\"\n}\n"},
		{"empty containers stay on one line", `{"a":{},"b":[]}`, "{\n  \"a\": {},\n  \"b\": []\n}\n"},
		{"null and bool", `[null,true,false]`, "[\n  null,\n  true,\n  false\n]\n"},
		{"nested", `{"a":{"b":[{"c":1}]}}`, "{\n  \"a\": {\n    \"b\": [\n      {\n        \"c\": 1\n      }\n    ]\n  }\n}\n"},
		{"scalar", `"x"`, "\"x\"\n"},
		{"ignores incoming whitespace", " {\n\"a\" :  1 } ", "{\n  \"a\": 1\n}\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			if err := printIndented(&out, json.RawMessage(tc.data)); err != nil {
				t.Fatalf("printIndented failed: %v", err)
			}
			if out.String() != tc.want {
				t.Errorf("got %q, want %q", out.String(), tc.want)
			}
		})
	}
}

func TestJSONOrString(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{`{"a": 1}`, `{"a": 1}`},
		{`42`, `42`},
		{`1.10`, `1.10`},
		{`true`, `true`},
		{`null`, `null`},
		{`"quoted"`, `"quoted"`},
		{"  [1]  \n", `[1]`},
		{`hello world`, `"hello world"`},
		{`007`, `"007"`},
		{`1 2`, `"1 2"`},
		{`<b> & "c"`, `"<b> & \"c\""`},
		{``, `""`},
		{"line\n", `"line\n"`},
	}
	for _, tc := range cases {
		got, err := jsonOrString([]byte(tc.input))
		if err != nil {
			t.Fatalf("jsonOrString(%q) failed: %v", tc.input, err)
		}
		if string(got) != tc.want {
			t.Errorf("jsonOrString(%q) = %s, want %s", tc.input, got, tc.want)
		}
	}
}

func TestLookupField(t *testing.T) {
	data := json.RawMessage(`{"name":"n","zero":0,"no":false,"gone":null,"event":{"id":"7","tags":["a",{"b":"c"}]},"text":"s"}`)
	cases := []struct {
		path string
		want string
	}{
		{"name", `"n"`},
		{"zero", `0`},
		{"no", `false`},
		{"gone", ``},
		{"missing", ``},
		{"event.id", `"7"`},
		{"event.tags[0]", `"a"`},
		{"event.tags[1].b", `"c"`},
		{"event.tags[9]", ``},
		{"gone.deeper", ``},
		{"missing.deeper[0]", ``},
	}
	for _, tc := range cases {
		got, err := lookupField(data, tc.path)
		if err != nil {
			t.Errorf("lookupField(%q) failed: %v", tc.path, err)
			continue
		}
		if string(got) != tc.want {
			t.Errorf("lookupField(%q) = %s, want %s", tc.path, got, tc.want)
		}
	}
}

func TestLookupFieldErrors(t *testing.T) {
	data := json.RawMessage(`{"text":"s","list":[1],"obj":{}}`)
	for _, path := range []string{"text.deeper", "list.key", "obj[0]", "a[b]", "a]"} {
		if _, err := lookupField(data, path); err == nil {
			t.Errorf("lookupField(%q): expected an error", path)
		} else if strings.Contains(err.Error(), "panic") {
			t.Errorf("lookupField(%q): %v", path, err)
		}
	}
}
