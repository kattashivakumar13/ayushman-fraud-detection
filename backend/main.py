from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import io
import anthropic
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Ayushman Bharat Fraud Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def score_risk(approved, charged):
    if approved == 0:
        return "low"
    pct = (charged - approved) / approved
    if pct > 0.30:
        return "high"
    elif pct > 0.05:
        return "medium"
    return "low"

def detect_flags(row):
    flags = []
    approved = row["approved"]
    charged = row["charged"]
    if approved > 0:
        pct = (charged - approved) / approved
        if pct > 0.30:
            flags.append("Overbill")
        elif pct > 0.05:
            flags.append("Moderate")
    if str(row.get("readmission", "")).lower() in ["yes", "1", "true"]:
        flags.append("Readmission")
    if row.get("days", 0) == 0 and any(k in str(row.get("procedure", "")).lower() for k in ["replacement", "repair", "surgery", "hysterectomy", "angioplasty", "appendectomy"]):
        flags.append("Phantom")
    if any(k in str(row.get("procedure", "")).lower() for k in ["stent", "implant"]) and approved > 0 and (charged / approved) > 3:
        flags.append("Implant fraud")
    return flags

@app.get("/")
def root():
    return {"message": "Ayushman Bharat Fraud Detection API is running!"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    contents = await file.read()
    df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    df.columns = df.columns.str.strip().str.lower()

    col_map = {
        "patient_id": ["patient_id", "id", "patient id"],
        "hospital": ["hospital_name", "hospital", "facility"],
        "procedure": ["procedure", "treatment", "surgery"],
        "approved": ["approved_amount", "approved", "sanctioned"],
        "charged": ["charged_amount", "charged", "billed"],
        "days": ["days_admitted", "days", "los"],
        "readmission": ["readmission_within_30days", "readmission", "readmit"],
    }

    mapped = {}
    for key, options in col_map.items():
        for opt in options:
            if opt in df.columns:
                mapped[key] = opt
                break

    claims = []
    for _, row in df.iterrows():
        approved = float(str(row.get(mapped.get("approved", ""), 0)).replace(",", "") or 0)
        charged = float(str(row.get(mapped.get("charged", ""), 0)).replace(",", "") or 0)
        r = {
            "patient_id": str(row.get(mapped.get("patient_id", ""), "—")),
            "hospital": str(row.get(mapped.get("hospital", ""), "—")),
            "procedure": str(row.get(mapped.get("procedure", ""), "—")),
            "approved": approved,
            "charged": charged,
            "excess": charged - approved,
            "days": int(row.get(mapped.get("days", ""), 0) or 0),
            "readmission": str(row.get(mapped.get("readmission", ""), "no")),
            "risk": score_risk(approved, charged),
            "flags": detect_flags({
                "approved": approved,
                "charged": charged,
                "procedure": row.get(mapped.get("procedure", ""), ""),
                "days": int(row.get(mapped.get("days", ""), 0) or 0),
                "readmission": str(row.get(mapped.get("readmission", ""), "no")),
            }),
        }
        claims.append(r)

    total = len(claims)
    high_risk = len([c for c in claims if c["risk"] == "high"])
    cleared = len([c for c in claims if c["risk"] == "low"])
    total_excess = sum(max(0, c["excess"]) for c in claims)

    summary = {
        "total": total,
        "high_risk": high_risk,
        "high_risk_pct": round(high_risk / total * 100, 1) if total else 0,
        "cleared": cleared,
        "cleared_pct": round(cleared / total * 100, 1) if total else 0,
        "total_excess": total_excess,
    }

    return {"claims": claims, "summary": summary}

@app.post("/investigate")
async def investigate_claim(claim: dict):
    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key:
        return {"investigation": "API key not found. Please check your .env file."}

    try:
        client = anthropic.Anthropic(api_key=api_key)

        prompt = f"""You are an Ayushman Bharat PM-JAY healthcare fraud detection expert.

Analyze this claim and provide a brief investigation note:

Patient ID: {claim.get('patient_id')}
Hospital: {claim.get('hospital')}
Procedure: {claim.get('procedure')}
Approved Amount: ₹{claim.get('approved')}
Charged Amount: ₹{claim.get('charged')}
Excess: ₹{claim.get('excess')}
Risk Level: {claim.get('risk')}
Fraud Flags: {', '.join(claim.get('flags', []))}

Provide:
1. Why this claim is suspicious
2. What fraud pattern it matches
3. Recommended action (Approve / Investigate / Reject)

Keep it short and clear — 3 to 4 lines max."""

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        return {"investigation": message.content[0].text}

    except Exception as e:
        return {"investigation": f"AI Agent error: {str(e)}"}