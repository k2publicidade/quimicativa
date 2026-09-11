#!/usr/bin/env python3
"""
Migra os dados do banco LOCAL de desenvolvimento (D1/SQLite do wrangler) e os
arquivos do R2 local para o Supabase. NAO usa Cloudflare.

  SUPABASE_URL=... SUPABASE_SECRET_KEY=... python scripts/migrate-local-to-supabase.py [--dry-run]

Detalhes importantes:
  * IDs sao preservados; as sequences (bigserial) sao reajustadas no fim.
  * A tabela `users` e IGNORADA: eram contas do login antigo (ChatGPT) e nao
    valem para o Supabase Auth. Isso tambem mantem o bootstrap intacto (o
    primeiro login no Supabase vira Direcao/ceo).
  * Colunas que referenciam usuarios (created_by/uploaded_by/reviewed_by/
    owner_id/actor_id) sao anuladas, porque as FKs do Postgres sao aplicadas
    de verdade (o D1 nao aplicava) e apontariam para ids inexistentes.
  * Arquivos do R2 local vao para o bucket do Supabase Storage com a MESMA chave.
"""
import glob
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

DRY = "--dry-run" in sys.argv
SB = os.environ.get("SUPABASE_URL")
SK = os.environ.get("SUPABASE_SECRET_KEY")
BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "arquivos")
if not SB or not SK:
    sys.exit("Defina SUPABASE_URL e SUPABASE_SECRET_KEY.")

USER_COLUMNS = {"owner_id", "actor_id", "created_by", "uploaded_by", "reviewed_by"}

ORDER = [
    "records", "intake_batches", "products", "lots", "suppliers", "fispq",
    "licenses", "customers", "orders", "order_items", "order_documents",
    "vehicles", "vehicle_documents", "vehicle_maintenance", "routes",
    "route_stops", "route_events", "erp_integrations", "profitability_entries",
    "files", "audit_log",
]

HEAD = {"apikey": SK, "Authorization": f"Bearer {SK}", "Content-Type": "application/json"}


def req(method, url, body=None, headers=None):
    data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method, headers=headers or HEAD)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def d1_path():
    files = [f for f in glob.glob(".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite")
             if "metadata" not in f]
    return files[0]


def r2_paths():
    db = [f for f in glob.glob(".wrangler/state/v3/r2/miniflare-R2BucketObject/*.sqlite")
          if "metadata" not in f]
    blobs = glob.glob(".wrangler/state/v3/r2/*/blobs")
    return (db[0] if db else None), (blobs[0] if blobs else None)


def main():
    con = sqlite3.connect(d1_path())
    con.row_factory = sqlite3.Row
    report = []
    total = 0

    for table in ORDER:
        try:
            rows = [dict(r) for r in con.execute(f'SELECT * FROM "{table}"')]
        except sqlite3.OperationalError as e:
            report.append(f"{table}: ignorada ({e})")
            continue
        if not rows:
            report.append(f"{table}: 0 linhas")
            continue

        for row in rows:
            for col in list(row):
                if col in USER_COLUMNS:
                    row[col] = None

        cols = list(rows[0].keys())
        stmts = [
            'INSERT INTO "%s" (%s) VALUES (%s) ON CONFLICT DO NOTHING'
            % (table, ",".join('"%s"' % c for c in cols), ",".join(literal(r[c]) for c in cols))
            for r in rows
        ]
        if DRY:
            report.append(f"{table}: {len(rows)} linhas (dry-run)")
            continue

        ok = True
        for i in range(0, len(stmts), 200):
            status, body = req("POST", f"{SB}/rest/v1/rpc/exec_sql_batch",
                               {"queries": stmts[i:i + 200]})
            if status >= 300:
                report.append(f"{table}: ERRO {status} {body}")
                ok = False
                break
        if ok:
            status, body = req("POST", f"{SB}/rest/v1/rpc/exec_sql",
                               {"query": f'SELECT COUNT(*)::int n FROM "{table}"', "expect_rows": True})
            total += len(rows)
            report.append(f"{table}: {len(rows)} migradas (agora no Supabase: {body[0]['n'] if isinstance(body, list) else '?'})")

    # sequences
    if not DRY:
        for table in ORDER:
            req("POST", f"{SB}/rest/v1/rpc/exec_sql", {
                "query": f"SELECT setval(pg_get_serial_sequence('\"{table}\"','id'), "
                         f"COALESCE((SELECT MAX(id) FROM \"{table}\"), 1))",
                "expect_rows": True})
        report.append("sequences reajustadas")

    # ---- arquivos do R2 local -> Supabase Storage ----
    r2db, blobdir = r2_paths()
    if r2db and blobdir and not DRY:
        rc = sqlite3.connect(r2db)
        objects = list(rc.execute("select key, blob_id, http_metadata from _mf_objects"))
        uploaded = 0
        for key, blob_id, meta in objects:
            path = os.path.join(blobdir, blob_id)
            if not os.path.exists(path):
                continue
            with open(path, "rb") as fh:
                data = fh.read()
            try:
                ctype = json.loads(meta).get("contentType") or "application/octet-stream"
            except Exception:
                ctype = "application/octet-stream"
            safe_key = urllib.parse.quote(key)
            status, body = req("POST", f"{SB}/storage/v1/object/{BUCKET}/{safe_key}", data,
                               headers={"apikey": SK, "Authorization": f"Bearer {SK}",
                                        "Content-Type": ctype, "x-upsert": "true"})
            if status < 300:
                uploaded += 1
            else:
                report.append(f"arquivo {key}: {status} {str(body)[:120]}")
        report.append(f"arquivos enviados ao Storage: {uploaded}/{len(objects)}")

    with open("migracao-local-supabase.log", "w", encoding="utf-8") as fh:
        fh.write("\n".join(report))
    print("\n".join(report))
    print(f"\nTOTAL de registros migrados: {total}")
    print("log: migracao-local-supabase.log")


if __name__ == "__main__":
    main()
