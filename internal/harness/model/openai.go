package model

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/shared"
)

const (
	BaseURLOpenAI = "https://api.openai.com/v1"
	BaseURLGemini = "https://generativelanguage.googleapis.com/v1beta/openai/"
	BaseURLLocal  = "http://localhost:11434/v1"
)

type openAIModel struct {
	client openai.Client
	model  string
}

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

func userMessage(m Message) openai.ChatCompletionMessageParamUnion {
	if len(m.Images) == 0 {
		return openai.UserMessage(m.Content)
	}
	parts := make([]openai.ChatCompletionContentPartUnionParam, 0, len(m.Images)+1)
	if m.Content != "" {
		parts = append(parts, openai.TextContentPart(m.Content))
	}
	for _, img := range m.Images {
		if len(img) == 0 {
			continue
		}
		dataURI := "data:image/png;base64," + base64.StdEncoding.EncodeToString(img)
		parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
			URL:    dataURI,
			Detail: "high",
		}))
	}
	return openai.UserMessage(parts)
}

func (o *openAIModel) Generate(ctx context.Context, req Request) (json.RawMessage, error) {
	msgs := make([]openai.ChatCompletionMessageParamUnion, 0, len(req.Messages))
	for _, m := range req.Messages {
		switch m.Role {
		case "system":
			msgs = append(msgs, openai.SystemMessage(m.Content))
		case "assistant":
			msgs = append(msgs, openai.AssistantMessage(m.Content))
		default:
			msgs = append(msgs, userMessage(m))
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
