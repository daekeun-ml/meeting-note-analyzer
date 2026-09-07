import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("stt.server:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), workers=1, timeout_keep_alive=75, log_level="info")
