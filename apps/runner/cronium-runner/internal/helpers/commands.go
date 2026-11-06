package helpers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// Client is what a helper command runs against: the runtime API when the runner
// reached it, or files in the work dir when it could not.
type Client interface {
	GetInput() (json.RawMessage, error)
	SetOutput(data json.RawMessage) error
	GetVariable(key string) (json.RawMessage, error)
	SetVariable(key string, value json.RawMessage) error
	SetCondition(condition bool) error
	GetContext() (json.RawMessage, error)
	ExecuteToolAction(tool, action string, config json.RawMessage) (json.RawMessage, error)
}

// Env is the outside world a helper command sees.
type Env struct {
	Stdin     io.Reader
	Stdout    io.Writer
	NewClient func() (Client, error)
}

// Main runs a helper command as a process: an error goes to stderr and exit 1.
// On success a command prints only what it was asked for, so a script's output
// matches its output in a container.
func Main(run func(*Env, []string) error) {
	env := &Env{Stdin: os.Stdin, Stdout: os.Stdout, NewClient: clientFromConfig}
	if err := run(env, os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func clientFromConfig() (Client, error) {
	config, err := LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}
	switch config.Mode {
	case APIMode:
		return NewAPIClient(config.APIEndpoint, config.APIToken, config.ExecutionID), nil
	case BundledMode:
		return NewBundledClient(config.WorkDir, config.ExecutionID), nil
	default:
		return nil, fmt.Errorf("unknown mode: %s", config.Mode)
	}
}

// takeFlag removes a boolean flag from args and reports whether it was there.
func takeFlag(args []string, flag string) ([]string, bool) {
	rest := make([]string, 0, len(args))
	found := false
	for _, arg := range args {
		if arg == flag {
			found = true
			continue
		}
		rest = append(rest, arg)
	}
	return rest, found
}

// RunInput prints the execution's input: JSON by default, or with --raw the way
// the bash SDK's cronium_input prints it.
func RunInput(env *Env, args []string) error {
	_, raw := takeFlag(args, "--raw")
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	data, err := client.GetInput()
	if err != nil {
		return err
	}
	return printValue(env.Stdout, data, raw)
}

// RunOutput stores the value read from stdin as the execution's output.
func RunOutput(env *Env, _ []string) error {
	input, err := io.ReadAll(env.Stdin)
	if err != nil {
		return fmt.Errorf("failed to read input: %w", err)
	}
	data, err := jsonOrString(input)
	if err != nil {
		return err
	}
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	return client.SetOutput(data)
}

// RunGetVariable prints a variable: JSON by default, or with --raw the bare value
// that cronium_get_variable prints.
func RunGetVariable(env *Env, args []string) error {
	args, raw := takeFlag(args, "--raw")
	if len(args) != 1 {
		return errors.New("usage: cronium.getVariable [--raw] <variable-key>")
	}
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	value, err := client.GetVariable(args[0])
	if err != nil {
		return err
	}
	return printValue(env.Stdout, value, raw)
}

// RunSetVariable sets a variable to its value argument, or else to stdin. A value
// that is a single JSON value is sent as that JSON, and anything else as a string.
func RunSetVariable(env *Env, args []string) error {
	if len(args) < 1 || len(args) > 2 {
		return errors.New("usage: cronium.setVariable <variable-key> [value]\nIf value is not provided, it is read from stdin")
	}
	var input []byte
	if len(args) == 2 {
		input = []byte(args[1])
	} else {
		var err error
		if input, err = io.ReadAll(env.Stdin); err != nil {
			return fmt.Errorf("failed to read input: %w", err)
		}
	}
	value, err := jsonOrString(input)
	if err != nil {
		return err
	}
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	return client.SetVariable(args[0], value)
}

// RunSetCondition sets the condition that ON_CONDITION workflow edges read. It
// accepts what the container's cronium_set_condition accepts.
func RunSetCondition(env *Env, args []string) error {
	if len(args) != 1 {
		return errors.New("usage: cronium.setCondition <true|false>")
	}
	var condition bool
	switch args[0] {
	case "true", "1", "yes", "on":
		condition = true
	case "false", "0", "no", "off":
		condition = false
	default:
		return errors.New("Invalid condition value. Use true/false, 1/0, yes/no, or on/off")
	}
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	return client.SetCondition(condition)
}

// RunEvent prints the execution context as indented JSON, or with --field <path>
// one field of it the way cronium_event_field prints it.
func RunEvent(env *Env, args []string) error {
	field := ""
	switch {
	case len(args) == 0:
	case len(args) == 2 && args[0] == "--field":
		field = args[1]
	default:
		return errors.New("usage: cronium.event [--field <path>]")
	}
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	context, err := client.GetContext()
	if err != nil {
		return err
	}
	if field != "" {
		value, err := lookupField(context, field)
		if err != nil {
			return err
		}
		return printValue(env.Stdout, value, true)
	}
	if context == nil {
		context = json.RawMessage("{}")
	}
	return printIndented(env.Stdout, context)
}

// RunToolAction runs a tool action and prints its result. The first argument says
// how the action's config is given:
//
//	execute <tool> <action>           config JSON on stdin
//	email <to> <subject> <body> [--cc <list>] [--bcc <list>] [--html]
//	slack <channel> <text> [--username <name>] [--icon-emoji <emoji>] [--icon-url <url>]
//	discord <channel_id> <content> [--embed <json>]
//
// Bash scripts cannot rely on jq being on a remote server, so the last three build
// the config here, with the same keys as the container's bash SDK.
func RunToolAction(env *Env, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: cronium.toolAction <execute|email|slack|discord> ...")
	}
	var tool, action string
	var config interface{}
	var err error
	switch args[0] {
	case "execute":
		if len(args) != 3 {
			return errors.New("usage: cronium.toolAction execute <tool> <action> (config JSON on stdin)")
		}
		tool, action = args[1], args[2]
		input, readErr := io.ReadAll(env.Stdin)
		if readErr != nil {
			return fmt.Errorf("failed to read input: %w", readErr)
		}
		if !json.Valid(input) {
			return errors.New("Invalid JSON configuration for tool action")
		}
		config = json.RawMessage(input)
	case "email":
		tool, action = "email", "send_message"
		config, err = emailConfig(args[1:])
	case "slack":
		tool, action = "slack", "send_message"
		config, err = slackConfig(args[1:])
	case "discord":
		tool, action = "discord", "send_message"
		config, err = discordConfig(args[1:])
	default:
		return fmt.Errorf("unknown tool action command: %s", args[0])
	}
	if err != nil {
		return err
	}

	encoded, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to encode tool action config: %w", err)
	}
	client, err := env.NewClient()
	if err != nil {
		return err
	}
	result, err := client.ExecuteToolAction(tool, action, encoded)
	if err != nil {
		return err
	}
	if result == nil {
		return nil
	}
	return printIndented(env.Stdout, result)
}

// optionValue returns the value after the option at args[i].
func optionValue(args []string, i int) (string, error) {
	if i+1 >= len(args) {
		return "", fmt.Errorf("%s needs a value", args[i])
	}
	return args[i+1], nil
}

// splitList splits a comma-separated list, trimming one space from each end of
// each item as the container's bash SDK does.
func splitList(list string) []string {
	items := strings.Split(list, ",")
	for i, item := range items {
		items[i] = strings.TrimSuffix(strings.TrimPrefix(item, " "), " ")
	}
	return items
}

func emailConfig(args []string) (interface{}, error) {
	if len(args) < 3 {
		return nil, errors.New("usage: cronium_send_email <to> <subject> <body> [--cc <list>] [--bcc <list>] [--html]")
	}
	config := struct {
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		Body    string   `json:"body"`
		CC      []string `json:"cc,omitempty"`
		BCC     []string `json:"bcc,omitempty"`
		HTML    bool     `json:"html,omitempty"`
	}{To: splitList(args[0]), Subject: args[1], Body: args[2]}

	options := args[3:]
	for i := 0; i < len(options); i++ {
		switch options[i] {
		case "--cc", "--bcc":
			value, err := optionValue(options, i)
			if err != nil {
				return nil, err
			}
			if options[i] == "--cc" {
				config.CC = splitList(value)
			} else {
				config.BCC = splitList(value)
			}
			i++
		case "--html":
			config.HTML = true
		}
	}
	return config, nil
}

func slackConfig(args []string) (interface{}, error) {
	if len(args) < 2 {
		return nil, errors.New("usage: cronium_send_slack_message <channel> <text> [--username <name>] [--icon-emoji <emoji>] [--icon-url <url>]")
	}
	config := struct {
		Channel   string `json:"channel"`
		Text      string `json:"text"`
		Username  string `json:"username,omitempty"`
		IconEmoji string `json:"icon_emoji,omitempty"`
		IconURL   string `json:"icon_url,omitempty"`
	}{Channel: args[0], Text: args[1]}

	options := args[2:]
	for i := 0; i < len(options); i++ {
		var target *string
		switch options[i] {
		case "--username":
			target = &config.Username
		case "--icon-emoji":
			target = &config.IconEmoji
		case "--icon-url":
			target = &config.IconURL
		default:
			continue
		}
		value, err := optionValue(options, i)
		if err != nil {
			return nil, err
		}
		*target = value
		i++
	}
	return config, nil
}

func discordConfig(args []string) (interface{}, error) {
	if len(args) < 2 {
		return nil, errors.New("usage: cronium_send_discord_message <channel_id> <content> [--embed <json>]")
	}
	config := struct {
		ChannelID string            `json:"channelId"`
		Content   string            `json:"content"`
		Embeds    []json.RawMessage `json:"embeds,omitempty"`
	}{ChannelID: args[0], Content: args[1]}

	if len(args) > 2 && args[2] == "--embed" {
		value, err := optionValue(args[2:], 0)
		if err != nil {
			return nil, err
		}
		if !json.Valid([]byte(value)) {
			return nil, errors.New("--embed needs a JSON value")
		}
		config.Embeds = []json.RawMessage{json.RawMessage(value)}
	}
	return config, nil
}
