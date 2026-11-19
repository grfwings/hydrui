package server

import (
	"crypto/tls"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func newRoostProxy(config Config) http.Handler {
	target, err := url.Parse(config.RoostURL)
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "Invalid Roost server URL", http.StatusInternalServerError)
		})
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: !config.RoostSecure}

	proxy := &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1,
		Director: func(r *http.Request) {
			contentType := r.Header.Get("Content-Type")
			accept := r.Header.Get("Accept")
			r.URL.Scheme = target.Scheme
			r.URL.Host = target.Host
			r.URL.Path = strings.TrimRight(target.Path, "/") + strings.TrimPrefix(r.URL.Path, "/roost")
			r.Host = target.Host
			r.Header = make(http.Header)
			if contentType != "" {
				r.Header.Set("Content-Type", contentType)
			}
			if accept != "" {
				r.Header.Set("Accept", accept)
			}
			// A nil value tells ReverseProxy not to add the caller's address.
			r.Header["X-Forwarded-For"] = nil
			if config.RoostAPIKey != "" {
				r.Header.Set("Authorization", "Bearer "+config.RoostAPIKey)
			}
		},
		ModifyResponse: func(response *http.Response) error {
			response.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "Error making Roost request", http.StatusBadGateway)
		},
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/roost/v1/model" && r.Method == http.MethodGet:
			proxy.ServeHTTP(w, r)
		case r.URL.Path == "/roost/v1/tag" && r.Method == http.MethodPost:
			proxy.ServeHTTP(w, r)
		default:
			http.Error(w, "Roost endpoint not found", http.StatusNotFound)
		}
	})
}
