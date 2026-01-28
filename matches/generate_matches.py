"""
A file that generates matches based off the data in ./data/match_stats.csv

""

#!/usr/bin/env python3

Generate Quarto match pages (one .qmd per match) from data/match_stats.csv.

Expected input schema (from your uploaded file):
- match_id, Team, Opponent, Season, Round, Player,
  Aces, Unforced Errors, Forced Errors, Double Faults, Winners, Errors Forced,
  win?, Team Score, Opponent Score, votes, BOG?
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
import pandas as pd


# ---------- helpers ----------

def slugify(name: str) -> str:
    """Make a URL/file-safe slug from a player name."""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def md_link(text: str, href: str) -> str:
    return f"[{text}]({href})"


def pick_score_block(g: pd.DataFrame, team_a: str, team_b: str) -> tuple[int | None, int | None]:
    """
    Choose a single direction row to pull score from:
    Prefer rows where Team==team_a & Opponent==team_b.
    Fallback to reversed.
    """
    def _coerce_int(x):
        try:
            return int(x)
        except Exception:
            return None

    cand = g[(g["Team"] == team_a) & (g["Opponent"] == team_b)]
    if len(cand) > 0:
        row = cand.iloc[0]
        return _coerce_int(row.get("Team Score")), _coerce_int(row.get("Opponent Score"))

    cand = g[(g["Team"] == team_b) & (g["Opponent"] == team_a)]
    if len(cand) > 0:
        row = cand.iloc[0]
        # reversed, so flip
        return _coerce_int(row.get("Opponent Score")), _coerce_int(row.get("Team Score"))

    return None, None


def build_stats_table(
    g: pd.DataFrame,
    team_a: str,
    team_b: str,
    players_dir_from_matches: str = "../players",
) -> str:
    """
    Create a markdown table:
    | Stat | Player1 | Player2 | Player3 | Player4 |
    """
    # keep first-seen order per team
    a_rows = g[g["Team"] == team_a].drop_duplicates(subset=["Player"])
    b_rows = g[g["Team"] == team_b].drop_duplicates(subset=["Player"])

    # If your data ever has >2 players per team, we’ll still include them,
    # but most comps should be exactly 2 per team.
    players = list(a_rows["Player"].tolist()) + list(b_rows["Player"].tolist())
    if len(players) != 4:
        # still generate a sane table
        pass

    # Determine which stat columns exist and have any non-null values
    exclude = {
        "match_id", "Team", "Opponent", "Season", "Round", "Player",
        "win?", "Team Score", "Opponent Score", "Unnamed: 17", "BOG?"
    }
    stat_cols = [c for c in g.columns if c not in exclude]

    # keep only columns with at least one value
    kept = []
    for c in stat_cols:
        col = g[c]
        if col.notna().any():
            kept.append(c)
    stat_cols = kept

    # Build a player->row mapping for stat lookup
    # Use the row where Team==team_a/team_b so stats line up with their team
    player_rows = {}
    for _, row in pd.concat([a_rows, b_rows]).iterrows():
        player_rows[str(row["Player"])] = row

    # Header with player links
    player_headers = []
    for p in players:
        slug = slugify(p)
        href = f"{players_dir_from_matches}/{slug}.qmd"
        player_headers.append(md_link(p, href))

    # Markdown table
    header = "| Stat | " + " | ".join(player_headers) + " |\n"
    header += "|---|---:|---:|---:|---:|\n"

    def fmt(v):
        if pd.isna(v):
            return ""
        if isinstance(v, bool):
            return "✓" if v else ""
        # handle True/False stored as strings
        if str(v).strip().lower() in {"true", "false"}:
            return "✓" if str(v).strip().lower() == "true" else ""
        # ints as ints, floats as clean
        try:
            fv = float(v)
            if fv.is_integer():
                return str(int(fv))
            return str(round(fv, 2))
        except Exception:
            return str(v)

    rows_md = ""
    for stat in stat_cols:
        vals = [fmt(player_rows.get(p, {}).get(stat, "")) for p in players]
        rows_md += "| " + str(stat) + " | " + " | ".join(vals) + " |\n"

    return header + rows_md


def render_match_page(
    match_id: str,
    g: pd.DataFrame,
    out_path: Path,
    players_dir_from_matches: str = "../players",
) -> None:
    # Get season/round (assume consistent within match_id)
    season = g["Season"].dropna().iloc[0] if "Season" in g.columns and g["Season"].notna().any() else ""
    rnd = g["Round"].dropna().iloc[0] if "Round" in g.columns and g["Round"].notna().any() else ""

    # Determine teams (two unique)
    teams = sorted(set(g["Team"].dropna().astype(str).unique().tolist()))
    if len(teams) < 2:
        # fallback: include Opponent too
        teams = sorted(set(pd.concat([g["Team"], g["Opponent"]]).dropna().astype(str).unique().tolist()))
    team_a, team_b = (teams + ["", ""])[:2]

    # Scores
    score_a, score_b = pick_score_block(g, team_a, team_b)
    score_line = f"**{score_a}–{score_b}**" if score_a is not None and score_b is not None else "**—**"

    # Team player lists with links
    a_players = g[g["Team"] == team_a].drop_duplicates(subset=["Player"])["Player"].tolist()
    b_players = g[g["Team"] == team_b].drop_duplicates(subset=["Player"])["Player"].tolist()

    def linked_players(ps):
        out = []
        for p in ps:
            slug = slugify(p)
            href = f"{players_dir_from_matches}/{slug}.qmd"
            out.append(md_link(p, href))
        return ", ".join(out) if out else "—"

    # Stats table
    stats_table = build_stats_table(g, team_a, team_b, players_dir_from_matches=players_dir_from_matches)

    title = f"Season {season} — Round {rnd} — {team_a} vs {team_b}".strip(" —")

    qmd = f"""---
title: "{title}"
description: "Match {match_id}"
categories: [Match]
format:
  html:
    toc: false
execute:
  echo: false
  warning: false
  message: false
---

<!-- GENERATED FILE: do not edit by hand -->

## Score

# {score_line}
  
**Season:** {season}  
**Round:** {rnd}

---

## Teams

**{team_a}:** {linked_players(a_players)}  
**{team_b}:** {linked_players(b_players)}

---

## Player stats

{stats_table}

---

[Back to matches](index.qmd)
"""

    out_path.write_text(qmd, encoding="utf-8")


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="Path to match_stats.csv (default: ../data/match_stats.csv relative to this script).",
    )
    parser.add_argument(
        "--outdir",
        type=str,
        default=None,
        help="Output directory for match QMDs (default: ../matches relative to this script).",
    )
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    in_path = Path(args.input) if args.input else (here / ".." / "data" / "match_stats.csv")
    out_dir = Path(args.outdir) if args.outdir else (here / ".." / "matches")

    if not in_path.exists():
        raise FileNotFoundError(f"Input file not found: {in_path}")

    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(in_path)

    # basic cleanup
    df.columns = [c.strip() for c in df.columns]
    if "match_id" not in df.columns:
        raise ValueError("Expected a 'match_id' column in the input CSV.")

    # Drop the common empty Excel column if present
    if "Unnamed: 17" in df.columns and df["Unnamed: 17"].isna().all():
        df = df.drop(columns=["Unnamed: 17"])

    # Generate pages
    n = 0
    for match_id, g in df.groupby("match_id", sort=True):
        match_id = str(match_id)
        out_path = out_dir / f"{match_id}.qmd"
        render_match_page(match_id, g, out_path)
        n += 1

    print(f"Generated {n} match pages in: {out_dir}")


if __name__ == "__main__":
    main()
