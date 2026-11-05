package helpers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// nilIfNull maps JSON null to nil, so every absent value looks the same.
func nilIfNull(data json.RawMessage) json.RawMessage {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return nil
	}
	return data
}

// jsonOrString keeps input that is a single JSON value as that JSON, and encodes
// anything else, including nothing at all, as a JSON string.
func jsonOrString(input []byte) (json.RawMessage, error) {
	if trimmed := bytes.TrimSpace(input); len(trimmed) > 0 && json.Valid(trimmed) {
		return json.RawMessage(trimmed), nil
	}
	encoded, err := encodeString(string(input))
	if err != nil {
		return nil, fmt.Errorf("failed to encode value: %w", err)
	}
	return encoded, nil
}

// printValue prints a value for a helper command. Without raw it prints JSON, for
// the Python and Node bindings to parse. With raw it prints what `jq -r` prints,
// which is what the bash SDK uses in a container: nothing for null, a string
// without its quotes, and anything else as indented JSON.
func printValue(w io.Writer, data json.RawMessage, raw bool) error {
	if !raw {
		if data == nil {
			data = json.RawMessage("null")
		}
		_, err := fmt.Fprintln(w, string(data))
		return err
	}
	data = nilIfNull(data)
	if data == nil {
		return nil
	}
	if bytes.TrimSpace(data)[0] == '"' {
		var text string
		if err := json.Unmarshal(data, &text); err != nil {
			return fmt.Errorf("failed to parse value: %w", err)
		}
		_, err := fmt.Fprintln(w, text)
		return err
	}
	return printIndented(w, data)
}

// printIndented prints JSON the way jq does: two-space indent, keys in their
// original order, numbers as written, and no HTML escapes. The runtime's encoder
// writes "<" as <, and json.Indent alone would pass that through.
func printIndented(w io.Writer, data json.RawMessage) error {
	var out bytes.Buffer
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := writeIndented(&out, decoder, 0); err != nil {
		return fmt.Errorf("failed to format value: %w", err)
	}
	out.WriteByte('\n')
	_, err := w.Write(out.Bytes())
	return err
}

func writeIndented(out *bytes.Buffer, decoder *json.Decoder, depth int) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	switch value := token.(type) {
	case json.Delim:
		closing := byte('}')
		if value == '[' {
			closing = ']'
		}
		out.WriteByte(byte(value))
		for first := true; decoder.More(); first = false {
			if !first {
				out.WriteByte(',')
			}
			out.WriteByte('\n')
			out.WriteString(strings.Repeat("  ", depth+1))
			if value == '{' {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				if err := writeString(out, key.(string)); err != nil {
					return err
				}
				out.WriteString(": ")
			}
			if err := writeIndented(out, decoder, depth+1); err != nil {
				return err
			}
			if !decoder.More() {
				out.WriteByte('\n')
				out.WriteString(strings.Repeat("  ", depth))
			}
		}
		if _, err := decoder.Token(); err != nil {
			return err
		}
		out.WriteByte(closing)
	case string:
		return writeString(out, value)
	case json.Number:
		out.WriteString(value.String())
	case bool:
		out.WriteString(strconv.FormatBool(value))
	case nil:
		out.WriteString("null")
	}
	return nil
}

func writeString(out *bytes.Buffer, text string) error {
	encoded, err := encodeString(text)
	if err != nil {
		return err
	}
	out.Write(encoded)
	return nil
}

// encodeString encodes a JSON string without HTML escapes.
func encodeString(text string) (json.RawMessage, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(text); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

var fieldStepPattern = regexp.MustCompile(`^([^.\[\]]*)((?:\[\d+\])*)$`)
var fieldIndexPattern = regexp.MustCompile(`\[(\d+)\]`)

// lookupField follows a jq-style path such as event.name or items[0].id. As in jq,
// a step past null is null, and a step into anything else that has no such key is
// an error.
func lookupField(data json.RawMessage, path string) (json.RawMessage, error) {
	current := nilIfNull(data)
	for _, step := range strings.Split(path, ".") {
		match := fieldStepPattern.FindStringSubmatch(step)
		if match == nil {
			return nil, fmt.Errorf("invalid field path: %s", path)
		}
		if match[1] != "" {
			next, err := lookupKey(current, match[1])
			if err != nil {
				return nil, err
			}
			current = next
		}
		for _, index := range fieldIndexPattern.FindAllStringSubmatch(match[2], -1) {
			position, err := strconv.Atoi(index[1])
			if err != nil {
				return nil, fmt.Errorf("invalid field path: %s", path)
			}
			next, err := lookupIndex(current, position)
			if err != nil {
				return nil, err
			}
			current = next
		}
	}
	return current, nil
}

func lookupKey(data json.RawMessage, key string) (json.RawMessage, error) {
	if data == nil {
		return nil, nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, errors.New("cannot index a non-object with \"" + key + "\"")
	}
	return nilIfNull(object[key]), nil
}

func lookupIndex(data json.RawMessage, position int) (json.RawMessage, error) {
	if data == nil {
		return nil, nil
	}
	var array []json.RawMessage
	if err := json.Unmarshal(data, &array); err != nil {
		return nil, fmt.Errorf("cannot index a non-array with %d", position)
	}
	if position >= len(array) {
		return nil, nil
	}
	return nilIfNull(array[position]), nil
}
