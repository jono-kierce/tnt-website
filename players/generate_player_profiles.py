#!/usr/bin/env python3
"""
Generate Quarto player profile pages from:
- ../data/match_stats.csv   (required)
- ../data/players.csv       (optional; enriches bio + image)

Outputs:
- ../players/{player_slug}.qmd

Notes:
- Any Player value containing 'fill-in' is treated as the same player,
  but that match is marked as a fill-in appearance.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
import pandas as pd


# ---------------- helpers ----------------

FILLIN_RE = re.compile(r"\bfill[\s-]*in\b", flags=re.IGNORECASE)

def slugify(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "unknown-player"

def canonical_player_name(raw: str) -> tuple[str, bool]:
    """
    Returns (canonical_name, is_fill_in).
    We strip 'fill-in' markers and surrounding punctuation.
    """
    raw = (raw or "").strip()
    is_fill_in = bool(FILLIN_RE.search(raw))

    # remove 'fill-in' token
    cleaned = FILLIN_RE.sub("", raw)

    # clean common wrappers: parentheses, extra dashes, multiple spaces
    cleaned = cleaned.replace("()", " ")
    cleaned = re.sub(r"[\(\)\[\]]", " ", cleaned)
    cleaned = re.sub(r"\s*[-–—]\s*", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # if stripping leaves nothing, fall back to original
    if not cleaned:
        cleaned = raw

    return cleaned, is_fill_in

def md_link(text: str, href: str) -> str:
    return f"[{text}]({href})"

def to_int(x):
    try:
        return int(float(x))
    except Exception:
        return None

def fmt_pct(num: float | None) -> str:
    if num is None:
        return "—"
    return f"{num:.1f}%"

def fmt_score(score_for: int | None, score_against: int | None) -> str:
    if score_for is None or score_against is None:
        return "—"
    return f"{score_for}–{score_against}"


# ---------------- core logic ----------------

def load_players_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["name", "bio", "image"])
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    # guarantee columns
    for c in ["name", "bio", "image"]:
        if c not in df.columns:
            df[c] = ""
    return df

def build_match_rows_for_player(df: pd.DataFrame, player_name: str) -> pd.DataFrame:
    """
    df must already have:
    - canonical_player
    - is_fill_in
    - player_slug
    """
    pdf = df[df["canonical_player"] == player_name].copy()

    if pdf.empty:
        return pdf

    # ensure numeric sort
    pdf["Season_num"] = pd.to_numeric(pdf["Season"], errors="coerce")
    pdf["Round_num"] = pd.to_numeric(pdf["Round"], errors="coerce")

    # For each match_id, build a single summary row for this player
    rows = []
    for match_id, g in pdf.groupby("match_id", sort=False):
        # the row for THIS player in THIS match might appear once (usually once)
        me = g.iloc[0]
        my_team = str(me["Team"])
        opp_team = str(me["Opponent"])

        season = to_int(me.get("Season"))
        rnd = to_int(me.get("Round"))

        # Determine partner: other player in the match with Team == my_team
        whole_match = df[df["match_id"] == match_id]
        team_mates = whole_match[whole_match["Team"].astype(str) == my_team].copy()
        team_mates = team_mates.drop_duplicates(subset=["canonical_player"])
        partners = [p for p in team_mates["canonical_player"].tolist() if p != player_name]
        partner = partners[0] if partners else ""

        # Determine opponents: players with Team == opp_team
        opps = whole_match[whole_match["Team"].astype(str) == opp_team].copy()
        opps = opps.drop_duplicates(subset=["canonical_player"])
        opp_list = opps["canonical_player"].tolist()

        # Result: use win? from me row if present
        won = me.get("win?", None)
        result = "W" if str(won).strip().lower() == "true" else ("L" if str(won).strip().lower() == "false" else "—")

        # Score: prefer Team Score / Opponent Score from the perspective of my team
        score_for = to_int(me.get("Team Score"))
        score_against = to_int(me.get("Opponent Score"))
        score = fmt_score(score_for, score_against)

        # Votes / BOG
        votes = to_int(me.get("votes"))
        bog = str(me.get("BOG?", "")).strip().lower() == "true"

        # Fill-in flag for this match for this player (if their raw name contained fill-in)
        fill_in_here = bool(me.get("is_fill_in", False))

        rows.append({
            "Season": season,
            "Round": rnd,
            "match_id": str(match_id),
            "Team": my_team,
            "Opponent": opp_team,
            "Partner": partner,
            "Opponents": opp_list,
            "Result": result,
            "Score": score,
            "Fill-in": fill_in_here,
            "Votes": votes if votes is not None else 0,
            "BOG": bog,
        })

    out = pd.DataFrame(rows)
    out = out.sort_values(["Season", "Round"], ascending=[True, True], na_position="last")
    return out

def render_player_qmd(
    player_name: str,
    player_slug: str,
    matches_df: pd.DataFrame,
    players_info: pd.DataFrame,
    out_path: Path,
) -> None:
    # player info lookup
    info = players_info[players_info["name"].astype(str) == str(player_name)]
    bio = ""
    image = ""
    if len(info) > 0:
        bio = str(info.iloc[0].get("bio", "") or "").strip()
        image = str(info.iloc[0].get("image", "") or "").strip()

    # headline stats
    matches_played = int(len(matches_df))
    wins = int((matches_df["Result"] == "W").sum())
    losses = int((matches_df["Result"] == "L").sum())
    win_rate = (wins / (wins + losses) * 100) if (wins + losses) > 0 else None

    fillin_count = int(matches_df["Fill-in"].sum()) if "Fill-in" in matches_df.columns else 0
    votes_total = int(matches_df["Votes"].sum()) if "Votes" in matches_df.columns else 0
    bog_count = int(matches_df["BOG"].sum()) if "BOG" in matches_df.columns else 0

    # image block
    img_block = ""
    if image:
        img_block = f'![]({image}){{fig-alt="{player_name} headshot" width=260}}'

    # build matches table markdown
    # Links:
    # - match page: ../matches/{match_id}.qmd
    # - partner/opponents: {slug}.qmd (same folder)
    table_lines = []
    table_lines.append("| Season | Round | Match | Partner | Opponents | Result | Score | MVP Votes | Fill-in |")
    table_lines.append("|---:|---:|---|---|---|:---:|:---:|---:|:---:|")

    def player_link(p: str) -> str:
        if not p:
            return "—"
        return md_link(p, f"{slugify(p)}.qmd")

    for _, r in matches_df.iterrows():
        season = r.get("Season", "")
        rnd = r.get("Round", "")
        match_id = r.get("match_id", "")
        team = r.get("Team", "")
        opp = r.get("Opponent", "")
        label = f"S{season}R{rnd} — {team} vs {opp}".strip()
        match_link = md_link(label, f"../matches/{match_id}.qmd")

        partner = player_link(r.get("Partner", ""))
        opps = r.get("Opponents", [])
        if isinstance(opps, list) and opps:
            opps_md = " & ".join(player_link(p) for p in opps)
        else:
            opps_md = "—"

        res = r.get("Result", "—")
        score = r.get("Score", "—")
        mvp_votes = r.get("Votes", 0)
        fill = "✓" if bool(r.get("Fill-in", False)) else ""

        table_lines.append(
            f"| {season} | {rnd} | {match_link} | {partner} | {opps_md} | {res} | {score} | {mvp_votes} | {fill} |"
        )

    matches_table_md = "\n".join(table_lines) if matches_played else "> No matches found."

    # Write QMD
    qmd = f"""---
title: "{player_name}"
description: "Tuesday Night Tennis player profile"
categories: [Player]
format:
  html:
    toc: true
    toc-location: right
---

<!-- GENERATED FILE: do not edit by hand -->

{img_block}

## Bio

{bio if bio else "—"}

## Snapshot

| Matches | Record | MVP Votes | BOGs |
|---|---|---|---|
| **{matches_played}**<br>fill-ins: {fillin_count} | **{wins}-{losses}**<br>win rate: {fmt_pct(win_rate)} | **{votes_total}** | **{bog_count}** |

## Matches

{matches_table_md}
"""
    out_path.write_text(qmd, encoding="utf-8")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--match_stats", type=str, default=None,
                        help="Path to match_stats.csv (default: ../data/match_stats.csv relative to this script)")
    parser.add_argument("--players_csv", type=str, default=None,
                        help="Path to players.csv (default: ../data/players.csv relative to this script)")
    parser.add_argument("--outdir", type=str, default=None,
                        help="Output directory for player QMDs (default: ../players relative to this script)")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    match_path = Path(args.match_stats) if args.match_stats else (here / ".." / "data" / "match_stats.csv")
    players_path = Path(args.players_csv) if args.players_csv else (here / ".." / "data" / "players.csv")
    out_dir = Path(args.outdir) if args.outdir else (here / ".." / "players")

    if not match_path.exists():
        raise FileNotFoundError(f"match_stats.csv not found: {match_path}")

    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(match_path)
    df.columns = [c.strip() for c in df.columns]

    # Drop empty excel column if present
    if "Unnamed: 17" in df.columns and df["Unnamed: 17"].isna().all():
        df = df.drop(columns=["Unnamed: 17"])

    # Canonicalize player names + fill-in flag
    canon = df["Player"].astype(str).apply(canonical_player_name)
    df["canonical_player"] = canon.apply(lambda t: t[0])
    df["is_fill_in"] = canon.apply(lambda t: t[1])
    df["player_slug"] = df["canonical_player"].apply(slugify)

    players_info = load_players_csv(players_path)

    # Ensure players.csv is keyed on canonical names
    players_info["name"] = players_info["name"].astype(str).apply(lambda s: canonical_player_name(s)[0])

    # Generate one page per unique player who appeared in match_stats
    unique_players = sorted(df["canonical_player"].dropna().astype(str).unique().tolist())

    n = 0
    for pname in unique_players:
        pslug = slugify(pname)
        pmatches = build_match_rows_for_player(df, pname)
        out_path = out_dir / f"{pslug}.qmd"
        render_player_qmd(pname, pslug, pmatches, players_info, out_path)
        n += 1

    print(f"Generated {n} player pages in: {out_dir}")

if __name__ == "__main__":
    main()
