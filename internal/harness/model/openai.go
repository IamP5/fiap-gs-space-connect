package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/shared"
)

// Provider base URLs (TECHSPEC §4). The provider swap is purely a base_url
// change: every supported backend speaks the OpenAI chat-completions wire, so one
// adapter drives all three.
const (
	BaseURLOpenAI = "https://api.openai.com/v1"
	BaseURLGemini = "https://generativelanguage.googleapis.com/v1beta/openai/"
	BaseURLLocal  = "http://localhost:11434/v1"
)

// openAIModel is the openai-go/v3 adapter behind the Model seam. It is the ONLY
// type in this package that talks to a network provider; it is constructed solely
// by the offline bake path (NewOpenAI), never reachable from the agent/coordinator
// hot loop (enforced by internal/harness/archtest).
type openAIModel struct {
	client openai.Client
	model  string
}

// NewOpenAI builds an OpenAI-compatible Model from cfg. BaseURL selects the
// provider (empty ⇒ OpenAI); APIKey authenticates it. It returns an error if no
// model id or API key is supplied so the bake command fails loudly rather than
// making an unauthenticated call.
func NewOpenAI(cfg Config) (Model, error) {
	if cfg.Model == "" {
		return nil, errors.New("model: Config.Model is required")
	}
	if cfg.APIKey == "" {
		return nil, errors.New("model: Config.APIKey is required (set OPENAI_API_KEY)")
	}
	opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey)}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	return &openAIModel{
		client: openai.NewClient(opts...),
		model:  cfg.Model,
	}, nil
}

// Generate sends req to the provider with strict response_format json_schema and
// returns the raw structured-output JSON. Strict mode binds the output to the
// caller's schema so the validate-and-repair pass in GenerateSpec only has to
// repair the provider's best-effort lapses, not arbitrary prose.
func (o *openAIModel) Generate(ctx context.Context, req Request) (json.RawMessage, error) {
	msgs := make([]openai.ChatCompletionMessageParamUnion, 0, len(req.Messages))
	for _, m := range req.Messages {
		switch m.Role {
		case "system":
			msgs = append(msgs, openai.SystemMessage(m.Content))
		case "assistant":
			msgs = append(msgs, openai.AssistantMessage(m.Content))
		default: // "user" and any unknown role default to a user turn
			msgs = append(msgs, openai.UserMessage(m.Content))
		}
	}

	var schema any
	if err := json.Unmarshal(req.Schema, &schema); err != nil {
		return nil, fmt.Errorf("model: request schema is not valid JSON: %w", err)
	}

	resp, err := o.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model:    o.model,
		Messages: msgs,
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   req.SchemaName,
					Strict: param.NewOpt(true),
					Schema: schema,
				},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("model: provider call failed: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("model: provider returned zero choices")
	}
	content := resp.Choices[0].Message.Content
	if content == "" {
		return nil, errors.New("model: provider returned empty content")
	}
	return json.RawMessage(content), nil
}
