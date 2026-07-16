<?php
// KayrosLab — Proxy LLM pour hebergement mutualise OVH (PHP).
// Role : cacher la cle LLM cote serveur, lever CORS/mixed-content, relayer vers Claude ou Ollama.
// Deployable par FTP (ex: www/api/govern.php). Ne PAS committer config.php (cle reelle).
declare(strict_types=1);

$cfg = @include __DIR__ . '/config.php';
if (!is_array($cfg)) {
  $cfg = [
    'ANTHROPIC_API_KEY' => getenv('ANTHROPIC_API_KEY') ?: '',
    'ANTHROPIC_MODEL'   => getenv('ANTHROPIC_MODEL') ?: 'claude-3-5-sonnet-latest',
    'ANTHROPIC_MAXTOK'  => (int)(getenv('ANTHROPIC_MAXTOK') ?: 1024),
    'OLLAMA_ENDPOINT'   => getenv('OLLAMA_ENDPOINT') ?: 'http://localhost:11434',
    'OLLAMA_MODEL'      => getenv('OLLAMA_MODEL') ?: 'llama3.2',
    'ALLOWED_ORIGIN'    => getenv('ALLOWED_ORIGIN') ?: '*',
    'SHARED_SECRET'     => getenv('KAYROS_SECRET') ?: '',
    'DEFAULT_PROVIDER'  => getenv('DEFAULT_PROVIDER') ?: 'anthropic',
  ];
}

// ---- CORS ----
header('Access-Control-Allow-Origin: ' . $cfg['ALLOWED_ORIGIN']);
header('Vary: Origin');
header('Access-Control-Allow-Headers: Content-Type, X-Kayros-Secret');
header('Access-Control-Allow-Methods: POST, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
header('Content-Type: application/json; charset=utf-8');

$fail = function (int $code, string $msg, $detail = null) {
  http_response_code($code);
  echo json_encode(array_filter(['error' => $msg, 'detail' => $detail], fn($v) => $v !== null));
  exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') $fail(405, 'POST requis');

// ---- Secret partage optionnel ----
if (!empty($cfg['SHARED_SECRET'])) {
  $sent = $_SERVER['HTTP_X_KAYROS_SECRET'] ?? '';
  if (!hash_equals((string)$cfg['SHARED_SECRET'], (string)$sent)) $fail(401, 'non autorise');
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($body) || empty($body['messages']) || !is_array($body['messages'])) $fail(400, 'champ "messages" requis');

$provider = strtolower((string)($body['provider'] ?? $cfg['DEFAULT_PROVIDER']));
$model    = $body['model'] ?? null;
$messages = $body['messages'];

function http_post_json(string $url, array $headers, array $payload, int $timeout): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_TIMEOUT => $timeout,
  ]);
  $resp = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return ['code' => $code, 'body' => json_decode((string)$resp, true), 'err' => $err];
}

function call_anthropic(array $cfg, ?string $model, array $messages): array {
  if (empty($cfg['ANTHROPIC_API_KEY'])) return ['error' => 'ANTHROPIC_API_KEY non configuree'];
  $system = '';
  $msgs = [];
  foreach ($messages as $m) {
    $role = $m['role'] ?? 'user';
    if ($role === 'system') { $system .= ($m['content'] ?? '') . "\n"; }
    else { $msgs[] = ['role' => $role === 'assistant' ? 'assistant' : 'user', 'content' => (string)($m['content'] ?? '')]; }
  }
  $payload = ['model' => $model ?: $cfg['ANTHROPIC_MODEL'], 'max_tokens' => (int)$cfg['ANTHROPIC_MAXTOK'], 'messages' => $msgs];
  if (trim($system) !== '') $payload['system'] = trim($system);
  $r = http_post_json('https://api.anthropic.com/v1/messages', [
    'content-type: application/json',
    'x-api-key: ' . $cfg['ANTHROPIC_API_KEY'],
    'anthropic-version: 2023-06-01',
  ], $payload, 60);
  if ($r['code'] >= 400 || $r['err']) return ['error' => 'anthropic http ' . $r['code'], 'detail' => $r['err'] ?: $r['body']];
  $text = '';
  foreach (($r['body']['content'] ?? []) as $blk) { if (($blk['type'] ?? '') === 'text') $text .= $blk['text']; }
  return ['text' => $text, 'provider' => 'anthropic', 'usage' => [
    'tokensIn'  => $r['body']['usage']['input_tokens']  ?? 0,
    'tokensOut' => $r['body']['usage']['output_tokens'] ?? 0,
  ]];
}

function call_ollama(array $cfg, ?string $model, array $messages): array {
  $payload = ['model' => $model ?: $cfg['OLLAMA_MODEL'], 'messages' => $messages, 'stream' => false];
  $r = http_post_json(rtrim($cfg['OLLAMA_ENDPOINT'], '/') . '/api/chat', ['content-type: application/json'], $payload, 120);
  if ($r['code'] >= 400 || $r['err']) return ['error' => 'ollama http ' . $r['code'], 'detail' => $r['err'] ?: $r['body']];
  return ['text' => $r['body']['message']['content'] ?? '', 'provider' => 'ollama', 'usage' => [
    'tokensIn'  => $r['body']['prompt_eval_count'] ?? 0,
    'tokensOut' => $r['body']['eval_count'] ?? 0,
  ]];
}

try {
  $out = $provider === 'ollama' ? call_ollama($cfg, $model, $messages) : call_anthropic($cfg, $model, $messages);
  if (isset($out['error'])) http_response_code(502);
  echo json_encode($out, JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
  $fail(500, $e->getMessage());
}
