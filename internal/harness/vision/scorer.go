package vision

import (
	"context"
	"encoding/json"
	"swarmbuild/internal/harness/model"
)

// ModelScorer bridges the production Model seam (model.Model) to the vision
// package's narrow Model interface: it translates the local modelRequest (with
// inline screenshot bytes) into a model.Request whose user message carries the
// image, so the openai adapter attaches it as a base64 data-URI image part. This
// is the ONLY place the vision pass touches the real model package, keeping the
// rest of the package fakeable.
type ModelScorer struct{ M model.Model }

// Generate forwards a vision request to the underlying model.Model, mapping each
// visionMessage (role/text/images) onto a model.Message. It is the adapter that
// makes model.Model satisfy the vision.Model interface.
func (s ModelScorer) Generate(ctx context.Context, req modelRequest) (json.RawMessage, error) {
	msgs := make([]model.Message, len(req.Messages))
	for i, m := range req.Messages {
		msgs[i] = model.Message{Role: m.Role, Content: m.Content, Images: m.Images}
	}
	return s.M.Generate(ctx, model.Request{
		Messages:   msgs,
		SchemaName: req.SchemaName,
		Schema:     req.Schema,
	})
}

// NewScorer wraps a constructed model.Model (the openai adapter, built by cmd/bake
// from a Config) as a vision.Model. cmd/bake passes the same adapter it uses for
// generation; a vision-capable model id (e.g. gpt-4o) is required for the image
// part to be read.
func NewScorer(m model.Model) Model { return ModelScorer{M: m} }
