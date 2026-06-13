package coordinator

import (
	"swarmbuild/internal/core/domain"
	"time"
)

type wallClock struct{}

func (wallClock) Now() domain.Tick { return domain.Tick(time.Now().UnixMilli()) }
