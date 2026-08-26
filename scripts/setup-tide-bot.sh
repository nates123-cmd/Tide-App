#!/bin/bash
# Wire a dedicated Tide Telegram bot: set the secrets, deploy, register the
# webhook. The token is read through a hidden prompt and never printed, never
# written to a file, and never placed in a command line as a literal.
#
#   bash scripts/setup-tide-bot.sh
#
# Get the token first: BotFather -> /newbot -> then /start your new bot.
set -euo pipefail

REF=xsmnfcmtbpeaccnyinkr
FN_URL="https://${REF}.supabase.co/functions/v1/drink-log"
CHAT_ID=8688138555

command -v supabase >/dev/null || { echo "supabase CLI not found"; exit 1; }

read -rsp 'Tide bot token (hidden, paste + Enter): ' TOK
echo
[ -n "$TOK" ] || { echo "Nothing entered."; exit 1; }

# Shape check only — no echo of the value.
if ! printf '%s' "$TOK" | grep -Eq '^[0-9]{6,}:[A-Za-z0-9_-]{30,}$'; then
  echo "That doesn't look like a bot token (expected 123456789:AA...)." >&2
  unset TOK; exit 1
fi

# GUARD: refuse to proceed against the shared bot. OpenClaw long-polls
# @Nate_beelink_bot, and Telegram gives each update to exactly ONE consumer, so
# registering a webhook there would silently steal OpenClaw's messages.
USERNAME=$(curl -s "https://api.telegram.org/bot${TOK}/getMe" \
  | python3 -c 'import json,sys; print((json.load(sys.stdin).get("result") or {}).get("username",""))')
if [ -z "$USERNAME" ]; then
  echo "Telegram rejected that token." >&2; unset TOK; exit 1
fi
if [ "$USERNAME" = "Nate_beelink_bot" ]; then
  echo "REFUSING: that is the shared OpenClaw bot. A webhook here would steal" >&2
  echo "OpenClaw's messages. Make a separate bot with BotFather /newbot." >&2
  unset TOK; exit 1
fi
echo "Bot: @${USERNAME}"

WH_SECRET=$(openssl rand -hex 24)

echo "Setting secrets..."
supabase secrets set --project-ref "$REF" \
  "TIDE_TG_TOKEN=${TOK}" \
  "TIDE_TG_CHAT=${CHAT_ID}" \
  "TIDE_TG_WEBHOOK_SECRET=${WH_SECRET}" >/dev/null

echo "Deploying drink-log..."
supabase functions deploy drink-log --project-ref "$REF" --no-verify-jwt 2>&1 | grep -i deployed || true

echo "Registering webhook..."
curl -s "https://api.telegram.org/bot${TOK}/setWebhook" \
  --data-urlencode "url=${FN_URL}" \
  --data-urlencode "secret_token=${WH_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  setWebhook:", d.get("description") or d)'

curl -s "https://api.telegram.org/bot${TOK}/getWebhookInfo" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin).get("result",{}); print("  url set:", bool(r.get("url")), "| pending:", r.get("pending_update_count"), "| last error:", r.get("last_error_message") or "none")'

unset TOK WH_SECRET

cat <<'EOF'

Done. Test it: message your new bot ".062" — it should reply with the gap
between the reading and the model. Alerts will now come from this bot too.

If it goes quiet, check getWebhookInfo's last_error_message.
EOF
