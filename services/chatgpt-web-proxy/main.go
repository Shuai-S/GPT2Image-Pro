package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
	stdhttp "net/http"
)

const (
	defaultBind        = ":3021"
	defaultProfile     = "chrome_146"
	defaultTimeoutSecs = 300
	defaultIdleTTL     = 30 * time.Minute
	defaultMaxBodyMB   = 32
	chatGPTOrigin      = "https://chatgpt.com"
)

type requestPayload struct {
	SessionKey string            `json:"sessionKey"`
	Method     string            `json:"method"`
	URLPath    string            `json:"urlPath"`
	TargetPath string            `json:"targetPath"`
	// TargetURL 为可选的绝对 URL（https）。设置后走主机白名单转发（用于 Adobe Firefly
	// 等多主机直连）；未设置时回落到 URLPath + chatgpt.com（保持原 ChatGPT Web 行为）。
	TargetURL  string            `json:"targetUrl"`
	Headers    map[string]string `json:"headers"`
	HeaderOrder []string         `json:"headerOrder"`
	BodyBase64 string            `json:"bodyBase64"`
}

type responsePayload struct {
	Status     int                 `json:"status"`
	Headers    map[string][]string `json:"headers"`
	BodyBase64 string              `json:"bodyBase64"`
}

type sessionClient struct {
	client   tls_client.HttpClient
	lastUsed time.Time
}

type server struct {
	secret        string
	profileName   string
	timeoutSecs   int
	upstreamProxy string
	maxBodyBytes  int64

	// cf_clearance 后备(仿 chatgpt2api):命中 Cloudflare 挑战时经 FlareSolverr(走同一 WARP 出口)
	// 解挑战、拿 cf_clearance+UA,注入会话 cookie jar 并覆盖 UA/Sec-Ch-Ua 后重试。默认启用、惰性。
	clearanceEnabled bool
	flareSolverrURL  string
	clearanceProxy   string
	clearanceTimeout int
	clearanceRefresh int

	mu      sync.Mutex
	clients map[string]*sessionClient
}

func main() {
	upstreamProxy := strings.TrimSpace(os.Getenv("CHATGPT_WEB_UPSTREAM_PROXY_URL"))
	s := &server{
		secret:        strings.TrimSpace(os.Getenv("CHATGPT_WEB_PROXY_SECRET")),
		profileName:   envString("CHATGPT_WEB_PROXY_PROFILE", defaultProfile),
		timeoutSecs:   envInt("CHATGPT_WEB_PROXY_TIMEOUT_SECONDS", defaultTimeoutSecs),
		upstreamProxy: upstreamProxy,
		maxBodyBytes:  int64(envInt("CHATGPT_WEB_PROXY_MAX_BODY_MB", defaultMaxBodyMB)) * 1024 * 1024,
		// 默认启用(设 CHATGPT_WEB_CLEARANCE_MODE=off 关);出口默认复用 WARP 上游、FlareSolverr 同网络。
		clearanceEnabled: !strings.EqualFold(envString("CHATGPT_WEB_CLEARANCE_MODE", "flaresolverr"), "off"),
		flareSolverrURL:  envString("FLARESOLVERR_URL", "http://flaresolverr:8191"),
		clearanceProxy:   envString("CHATGPT_WEB_CLEARANCE_PROXY_URL", upstreamProxy),
		clearanceTimeout: envInt("CHATGPT_WEB_CLEARANCE_TIMEOUT_SECONDS", 60),
		clearanceRefresh: envInt("CHATGPT_WEB_CLEARANCE_REFRESH_SECONDS", 3600),
		clients:          map[string]*sessionClient{},
	}

	go s.cleanupLoop()

	mux := stdhttp.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/request", s.handleRequest)

	bind := envString("CHATGPT_WEB_PROXY_BIND", defaultBind)
	log.Printf("chatgpt-web-proxy listening on %s profile=%s", bind, s.profileName)
	if err := stdhttp.ListenAndServe(bind, mux); err != nil {
		log.Fatal(err)
	}
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func (s *server) handleHealth(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleRequest(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		writeError(w, stdhttp.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.secret != "" && r.Header.Get("X-Proxy-Secret") != s.secret {
		writeError(w, stdhttp.StatusUnauthorized, "unauthorized")
		return
	}

	defer r.Body.Close()
	var payload requestPayload
	if err := json.NewDecoder(stdhttp.MaxBytesReader(w, r.Body, 8*1024*1024)).Decode(&payload); err != nil {
		writeError(w, stdhttp.StatusBadRequest, "invalid request payload")
		return
	}

	result, err := s.forward(payload)
	if err != nil {
		writeError(w, stdhttp.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (s *server) forward(payload requestPayload) (*responsePayload, error) {
	var targetURL string
	var err error
	if strings.TrimSpace(payload.TargetURL) != "" {
		targetURL, err = buildAllowlistedURL(payload.TargetURL)
	} else {
		targetURL, err = buildTargetURL(payload.URLPath)
	}
	if err != nil {
		return nil, err
	}

	method := strings.ToUpper(strings.TrimSpace(payload.Method))
	if method == "" {
		method = fhttp.MethodGet
	}

	body, err := decodeBody(payload.BodyBase64)
	if err != nil {
		return nil, err
	}

	client, err := s.getClient(payload.SessionKey)
	if err != nil {
		return nil, err
	}

	// 单次构建+发送:每次按当前 payload.Headers/Order 重建请求(重试时头已被 clearance 覆盖）。
	send := func() (int, fhttp.Header, []byte, error) {
		var reader io.Reader
		if len(body) > 0 {
			reader = bytes.NewReader(body)
		}
		req, reqErr := fhttp.NewRequest(method, targetURL, reader)
		if reqErr != nil {
			return 0, nil, nil, reqErr
		}
		applyHeaders(req, payload.Headers, payload.HeaderOrder)
		resp, doErr := client.Do(req)
		if doErr != nil {
			return 0, nil, nil, doErr
		}
		defer resp.Body.Close()
		rb, readErr := readLimited(resp.Body, s.maxBodyBytes)
		if readErr != nil {
			return 0, nil, nil, readErr
		}
		return resp.StatusCode, resp.Header, rb, nil
	}

	// cf_clearance 后备仅对 chatgpt.com 请求生效。已有活跃 clearance 则先注入(cookie 进 jar + 覆盖 UA)。
	isChatGPT := strings.HasPrefix(targetURL, chatGPTOrigin)
	if s.clearanceEnabled && isChatGPT {
		if ua, cookies := getActiveClearance(); ua != "" {
			applyClearanceHeaders(payload.Headers, ua)
			s.injectCookies(client, cookies)
		}
	}

	status, respHeaders, respBody, err := send()
	if err != nil {
		return nil, err
	}

	// 命中 Cloudflare 挑战 → 经 FlareSolverr(同一 WARP 出口)刷 clearance → 注入 → 重试一次。
	if s.clearanceEnabled && isChatGPT && isCloudflareChallenge(status, respBody) {
		if ua, cookies := s.refreshClearance(); ua != "" {
			applyClearanceHeaders(payload.Headers, ua)
			s.injectCookies(client, cookies)
			status, respHeaders, respBody, err = send()
			if err != nil {
				return nil, err
			}
		}
	}

	return &responsePayload{
		Status:     status,
		Headers:    mapHeaders(respHeaders),
		BodyBase64: base64.StdEncoding.EncodeToString(respBody),
	}, nil
}

// ===== cf_clearance 后备(仿 basketikun/chatgpt2api:WARP + FlareSolverr 刷 cf_clearance) =====
//
// cf_clearance 绑「出口 IP + UA」不绑 ChatGPT 账号,而全池共用同一 WARP 上游 → 一份 clearance 全池通用,
// 故用全局单例缓存 + 单飞(clrRefreshMu 串行 + 双检):一次挑战波只真解一次,不至于把 FlareSolverr
// 的无头 Chrome 打爆。默认启用但完全惰性:无挑战时不触发、不注入,对现网零影响。

var (
	clrMu        sync.Mutex
	clrUA        string
	clrCookies   []*fhttp.Cookie
	clrExpires   time.Time
	clrRefreshMu sync.Mutex
)

var chromeMajorRe = regexp.MustCompile(`Chrome/(\d+)`)

var clearanceCookieNames = map[string]bool{
	"cf_clearance": true, "__cf_bm": true, "_cfuvid": true, "__cflb": true,
}

type flareResp struct {
	Status   string `json:"status"`
	Message  string `json:"message"`
	Solution struct {
		UserAgent string `json:"userAgent"`
		Cookies   []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"cookies"`
	} `json:"solution"`
}

// getActiveClearance 返回未过期的全局 clearance(UA + cookies);无/过期返回空。
func getActiveClearance() (string, []*fhttp.Cookie) {
	clrMu.Lock()
	defer clrMu.Unlock()
	if clrUA == "" || time.Now().After(clrExpires) {
		return "", nil
	}
	return clrUA, clrCookies
}

// isCloudflareChallenge 判定响应是否 Cloudflare 挑战/拦截页(仅 403/503 + 特征串)。
func isCloudflareChallenge(status int, body []byte) bool {
	if status != 403 && status != 503 {
		return false
	}
	b := strings.ToLower(string(body))
	return strings.Contains(b, "just a moment") ||
		strings.Contains(b, "attention required") ||
		strings.Contains(b, "cf-chl-") ||
		strings.Contains(b, "__cf_chl_") ||
		strings.Contains(b, "cf-browser-verification") ||
		strings.Contains(b, "challenge-platform")
}

func platformFromUA(ua string) string {
	switch {
	case strings.Contains(ua, "Windows"):
		return "Windows"
	case strings.Contains(ua, "Macintosh"), strings.Contains(ua, "Mac OS X"):
		return "macOS"
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "Linux"):
		return "Linux"
	default:
		return "Windows"
	}
}

// applyClearanceHeaders 覆盖 UA 与 Sec-Ch-Ua*(cf_clearance 绑 UA,必须一致,否则 UA↔Sec-Ch-Ua 打架)。
func applyClearanceHeaders(headers map[string]string, ua string) {
	if headers == nil {
		return
	}
	headers["User-Agent"] = ua
	if m := chromeMajorRe.FindStringSubmatch(ua); m != nil {
		v := m[1]
		headers["Sec-Ch-Ua"] = fmt.Sprintf(`"Chromium";v="%s", "Google Chrome";v="%s", "Not?A_Brand";v="24"`, v, v)
		headers["Sec-Ch-Ua-Full-Version-List"] = fmt.Sprintf(`"Chromium";v="%s.0.0.0", "Google Chrome";v="%s.0.0.0", "Not?A_Brand";v="24.0.0.0"`, v, v)
		headers["Sec-Ch-Ua-Full-Version"] = fmt.Sprintf(`"%s.0.0.0"`, v)
	}
	headers["Sec-Ch-Ua-Platform"] = fmt.Sprintf(`"%s"`, platformFromUA(ua))
}

// injectCookies 把 cf_clearance 等写入会话 tls-client 的 cookie jar(chatgpt.com 域),自动随后续请求发送。
func (s *server) injectCookies(client tls_client.HttpClient, cookies []*fhttp.Cookie) {
	if len(cookies) == 0 {
		return
	}
	u, err := url.Parse(chatGPTOrigin)
	if err != nil {
		return
	}
	client.SetCookies(u, cookies)
}

// refreshClearance 经 FlareSolverr(走 WARP 出口)解 chatgpt.com 挑战,拿 cf_clearance+UA,写全局缓存。
// clrRefreshMu 串行 + 双检 → 一次挑战波只真解一次;失败返回空并记日志(不阻断,退回原响应)。
func (s *server) refreshClearance() (string, []*fhttp.Cookie) {
	clrRefreshMu.Lock()
	defer clrRefreshMu.Unlock()
	if ua, cookies := getActiveClearance(); ua != "" {
		return ua, cookies
	}
	reqBody := map[string]any{
		"cmd":        "request.get",
		"url":        chatGPTOrigin + "/",
		"maxTimeout": s.clearanceTimeout * 1000,
	}
	if s.clearanceProxy != "" {
		reqBody["proxy"] = map[string]string{"url": s.clearanceProxy}
	}
	buf, _ := json.Marshal(reqBody)
	httpClient := &stdhttp.Client{Timeout: time.Duration(s.clearanceTimeout+20) * time.Second}
	resp, err := httpClient.Post(strings.TrimRight(s.flareSolverrURL, "/")+"/v1", "application/json", bytes.NewReader(buf))
	if err != nil {
		log.Printf("cf_clearance refresh error: %v", err)
		return "", nil
	}
	defer resp.Body.Close()
	var fr flareResp
	if decErr := json.NewDecoder(resp.Body).Decode(&fr); decErr != nil || fr.Status != "ok" {
		log.Printf("cf_clearance refresh failed status=%s msg=%s", fr.Status, fr.Message)
		return "", nil
	}
	var cookies []*fhttp.Cookie
	hasClearance := false
	for _, c := range fr.Solution.Cookies {
		if clearanceCookieNames[c.Name] && c.Value != "" {
			cookies = append(cookies, &fhttp.Cookie{Name: c.Name, Value: c.Value, Domain: "chatgpt.com", Path: "/"})
			if c.Name == "cf_clearance" {
				hasClearance = true
			}
		}
	}
	ua := strings.TrimSpace(fr.Solution.UserAgent)
	if !hasClearance || ua == "" {
		log.Printf("cf_clearance refresh: missing cf_clearance/ua")
		return "", nil
	}
	clrMu.Lock()
	clrUA = ua
	clrCookies = cookies
	clrExpires = time.Now().Add(time.Duration(s.clearanceRefresh) * time.Second)
	clrMu.Unlock()
	log.Printf("cf_clearance refreshed ua=%s cookies=%d", ua, len(cookies))
	return ua, cookies
}

func buildTargetURL(urlPath string) (string, error) {
	if !strings.HasPrefix(urlPath, "/") || strings.HasPrefix(urlPath, "//") {
		return "", errors.New("urlPath must be an absolute path")
	}
	parsed, err := url.Parse(chatGPTOrigin + urlPath)
	if err != nil {
		return "", fmt.Errorf("invalid urlPath: %w", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "chatgpt.com" {
		return "", errors.New("only https://chatgpt.com requests are allowed")
	}
	return parsed.String(), nil
}

// buildAllowlistedURL 校验绝对 URL：必须 https，且主机在白名单内（chatgpt.com 或 Adobe
// 系域名）。用于 Adobe Firefly 直连的多主机转发（firefly-3p / IMS / platform-cs 等）。
func buildAllowlistedURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("invalid targetUrl: %w", err)
	}
	if parsed.Scheme != "https" {
		return "", errors.New("only https targetUrl is allowed")
	}
	if !isAllowlistedHost(parsed.Hostname()) {
		return "", fmt.Errorf("host not allowlisted: %s", parsed.Hostname())
	}
	return parsed.String(), nil
}

func isAllowlistedHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if host == "chatgpt.com" {
		return true
	}
	// Adobe 系域名（含子域）。
	suffixes := []string{".adobe.io", ".adobe.com", ".adobelogin.com"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func decodeBody(value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	body, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, errors.New("bodyBase64 is invalid")
	}
	return body, nil
}

func applyHeaders(req *fhttp.Request, headers map[string]string, order []string) {
	req.Header = fhttp.Header{}
	for key, value := range headers {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" || shouldSkipHeader(trimmedKey) {
			continue
		}
		req.Header.Set(trimmedKey, value)
	}
	if len(order) > 0 {
		headerOrder := make([]string, 0, len(order))
		for _, key := range order {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey == "" || shouldSkipHeader(trimmedKey) {
				continue
			}
			headerOrder = append(headerOrder, strings.ToLower(trimmedKey))
		}
		if len(headerOrder) > 0 {
			req.Header[fhttp.HeaderOrderKey] = headerOrder
		}
	}
}

func shouldSkipHeader(key string) bool {
	switch strings.ToLower(key) {
	case "host", "content-length", "connection":
		return true
	default:
		return false
	}
}

func (s *server) getClient(sessionKey string) (tls_client.HttpClient, error) {
	key := strings.TrimSpace(sessionKey)
	if key == "" {
		key = "default"
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing := s.clients[key]; existing != nil {
		existing.lastUsed = time.Now()
		return existing.client, nil
	}

	profile, ok := profiles.MappedTLSClients[s.profileName]
	if !ok {
		return nil, fmt.Errorf("unknown tls-client profile: %s", s.profileName)
	}

	options := []tls_client.HttpClientOption{
		tls_client.WithTimeoutSeconds(s.timeoutSecs),
		tls_client.WithClientProfile(profile),
		tls_client.WithCookieJar(tls_client.NewCookieJar()),
		tls_client.WithDisableHttp3(),
		tls_client.WithCatchPanics(),
	}
	if s.upstreamProxy != "" {
		options = append(options, tls_client.WithProxyUrl(s.upstreamProxy))
	}

	client, err := tls_client.NewHttpClient(tls_client.NewNoopLogger(), options...)
	if err != nil {
		return nil, err
	}

	s.clients[key] = &sessionClient{client: client, lastUsed: time.Now()}
	return client, nil
}

func (s *server) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		for key, item := range s.clients {
			if time.Since(item.lastUsed) > defaultIdleTTL {
				item.client.CloseIdleConnections()
				delete(s.clients, key)
			}
		}
		s.mu.Unlock()
	}
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("upstream response body is too large")
	}
	return data, nil
}

func mapHeaders(headers fhttp.Header) map[string][]string {
	result := make(map[string][]string, len(headers))
	for key, values := range headers {
		if strings.EqualFold(key, fhttp.HeaderOrderKey) {
			continue
		}
		copied := make([]string, len(values))
		copy(copied, values)
		result[key] = copied
	}
	return result
}

func writeJSON(w stdhttp.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write json failed: %v", err)
	}
}

func writeError(w stdhttp.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
