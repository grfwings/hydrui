package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRoostProxyForwardsModelAndTagEndpoints(t *testing.T) {
	t.Parallel()

	var seenAuth string
	var seenPath string
	var seenContentType string
	var seenBody string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = r.Header.Get("Authorization")
		seenPath = r.URL.Path
		seenContentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		seenBody = string(body)
		w.Header().Set("Set-Cookie", "upstream=secret")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	handler := newRoostProxy(Config{
		RoostURL:    upstream.URL + "/prefix",
		RoostSecure: true,
		RoostAPIKey: "roost-token",
	})

	req := httptest.NewRequest(http.MethodGet, "/roost/v1/model", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "/prefix/v1/model", seenPath)
	assert.Equal(t, "Bearer roost-token", seenAuth)
	assert.Empty(t, rec.Header().Get("Set-Cookie"))

	tagReq := httptest.NewRequest(http.MethodPost, "/roost/v1/tag", strings.NewReader("--boundary--"))
	tagReq.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	tagRec := httptest.NewRecorder()
	handler.ServeHTTP(tagRec, tagReq)

	require.Equal(t, http.StatusOK, tagRec.Code)
	assert.Equal(t, "/prefix/v1/tag", seenPath)
	assert.Equal(t, "multipart/form-data; boundary=boundary", seenContentType)
	assert.Equal(t, "--boundary--", seenBody)

	notFoundReq := httptest.NewRequest(http.MethodGet, "/roost/healthz", nil)
	notFoundRec := httptest.NewRecorder()
	handler.ServeHTTP(notFoundRec, notFoundReq)
	assert.Equal(t, http.StatusNotFound, notFoundRec.Code)
}
