#!/bin/bash
cd /home/z/my-project/zai-bot
export TELEGRAM_BOT_TOKEN="8886940587:AAGab7Kcq-4lN7g3tj7AXhuPPDY5oEQ0P1M"
export ZAI_BASE_URL="http://172.25.136.193:8080/v1"
export ZAI_API_KEY="Z.ai"
export ZAI_CHAT_ID="chat-4f227b19-cf4a-4cb6-ae91-5a553834e6de"
export ZAI_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiY2YwYmM3MTktY2YxYi00ZGY2LWE5NDYtOTI3MjQ2YWJlMmY3IiwiY2hhdF9pZCI6ImNoYXQtNGYyMjdiMTktY2Y0YS00Y2I2LWFlOTEtNWE1NTM4MzRlNmRlIiwicGxhdGZvcm0iOiJ6YWkifQ.CYqYha_LEtsIM2d_2_3ky2VIdf0zrGDwjUH36YXFPDU"
export ZAI_USER_ID="cf0bc719-cf1b-4df6-a946-927246abe2f7"
export GH_PAT="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"
export GH_USERNAME="EngKHALIDx"
export ALLOWED_USERNAMES="o_okh1"
export DEFAULT_MODEL="glm-4-flash"
exec ./node_modules/.bin/tsx src/index.ts
