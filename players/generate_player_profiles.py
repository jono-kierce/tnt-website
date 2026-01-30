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

def parse_score_list(value) -> list[str] | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text:
        return None
    return [item.strip() for item in text.split(",") if item.strip()]

def fmt_tennis_score(team_score, opp_score) -> str:
    team_list = parse_score_list(team_score)
    opp_list = parse_score_list(opp_score)
    if not team_list or not opp_list:
        return "—"
    pairs = []
    for i in range(max(len(team_list), len(opp_list))):
        t_val = team_list[i] if i < len(team_list) else "?"
        o_val = opp_list[i] if i < len(opp_list) else "?"
        pairs.append(f"{t_val}–{o_val}")
    return ", ".join(pairs)

def fmt_stat(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, float) and pd.isna(value):
        return "—"
    text = str(value).strip()
    if not text:
        return "—"
    return text

def round_label(value: str) -> str:
    mapping = {
        "QF": "Quarter Final",
        "SF": "Semi Final",
        "GF": "Championship Final",
    }
    key = str(value or "").strip().upper()
    return mapping.get(key, value)

def most_common_value(values) -> str:
    if values is None:
        return ""
    series = pd.Series(list(values)).dropna().astype(str)
    series = series[series.str.strip().astype(bool)]
    if series.empty:
        return ""
    return series.value_counts().index[0]

def fmt_per_match(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:.1f}"


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
        if votes is None:
            votes = to_int(me.get("MVP Votes"))
        bog = str(me.get("BOG?", "")).strip().lower() == "true"

        # Player stats
        winners = to_int(me.get("Winners"))
        unforced_errors = to_int(me.get("Unforced Errors"))
        aces = to_int(me.get("Aces"))
        errors_forced = to_int(me.get("Errors Forced"))
        double_faults = to_int(me.get("Double Faults"))

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
            "Winners": winners,
            "Unforced Errors": unforced_errors,
            "Aces": aces,
            "Errors Forced": errors_forced,
            "Double Faults": double_faults,
        })

    out = pd.DataFrame(rows)
    out = out.sort_values(["Season", "Round"], ascending=[True, True], na_position="last")
    return out

def build_finals_rows_for_player(df: pd.DataFrame, player_name: str) -> pd.DataFrame:
    pdf = df[df["canonical_player"] == player_name].copy()
    if pdf.empty:
        return pdf

    pdf["Season_num"] = pd.to_numeric(pdf["Season"], errors="coerce")
    rows = []
    for match_id, g in pdf.groupby("match_id", sort=False):
        me = g.iloc[0]
        season = to_int(me.get("Season"))
        round_name = round_label(me.get("Round", ""))
        score = fmt_tennis_score(me.get("Team Score"), me.get("Opponent Score"))
        final_label = f"{round_name} ({score})" if score != "—" else str(round_name)

        rows.append({
            "Season": season,
            "Final": final_label,
            "Winners": to_int(me.get("Winners")),
            "Unforced Errors": to_int(me.get("Unforced Errors")),
            "Aces": to_int(me.get("Aces")),
            "Errors Forced": to_int(me.get("Errors Forced")),
            "Finals MVP Votes": to_int(me.get("MVP Votes")),
        })

    out = pd.DataFrame(rows)
    out = out.sort_values(["Season"], ascending=[True], na_position="last")
    return out

def render_player_qmd(
    player_name: str,
    player_slug: str,
    matches_df: pd.DataFrame,
    finals_df: pd.DataFrame,
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
    matches_played_total = int(len(matches_df))
    wins = int((matches_df["Result"] == "W").sum())
    losses = int((matches_df["Result"] == "L").sum())
    win_rate = (wins / (wins + losses) * 100) if (wins + losses) > 0 else None

    fillin_count = int(matches_df["Fill-in"].sum()) if "Fill-in" in matches_df.columns else 0
    votes_total = int(matches_df["Votes"].sum()) if "Votes" in matches_df.columns else 0
    bog_count = int(matches_df["BOG"].sum()) if "BOG" in matches_df.columns else 0
    finals_votes_total = int(finals_df["Finals MVP Votes"].sum()) if finals_df is not None and not finals_df.empty else 0

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

    fillin_matches = matches_df["Fill-in"].sum() if "Fill-in" in matches_df.columns else 0
    season_header = "Matches Played [Filled in]" if fillin_matches > 0 else "Matches Played"

    season_summary_lines = []
    season_summary_lines.append(f"| Season | {season_header} | Wins | Team | Partner | MVP Votes |")
    season_summary_lines.append("|---:|---:|---:|---|---|---:|")

    for season, season_df in matches_df.groupby("Season", dropna=True):
        season_df = season_df.copy()
        season_df = season_df.sort_values("Round", na_position="last")

        non_fill_df = season_df[~season_df["Fill-in"]]
        team_pool = non_fill_df["Team"] if not non_fill_df.empty else season_df["Team"]
        partner_pool = non_fill_df["Partner"] if not non_fill_df.empty else season_df["Partner"]

        team = most_common_value(team_pool)
        partner = most_common_value(partner_pool)
        partner_md = player_link(partner) if partner else "—"

        team_matches = int((~season_df["Fill-in"]).sum())
        fillin_count = int(season_df["Fill-in"].sum())
        matches_played = f"{team_matches} [{fillin_count}]" if fillin_count > 0 else f"{team_matches}"

        season_wins = int((season_df.loc[~season_df["Fill-in"], "Result"] == "W").sum())
        mvp_votes = int(season_df.loc[~season_df["Fill-in"], "Votes"].sum())

        season_summary_lines.append(
            f"| {season} | {matches_played} | {season_wins} | {team or '—'} | {partner_md} | {mvp_votes} |"
        )

    season_summary_md = "\n".join(season_summary_lines) if matches_played_total else "> No matches found."

    stats_lines = []
    stats_lines.append(
        "| Season | Winners Per Match | Unforced Errors Per Match | Aces Per Match | Errors Forced Per Game | Double Faults Per Match |"
    )
    stats_lines.append("|---:|---:|---:|---:|---:|---:|")

    for season, season_df in matches_df.groupby("Season", dropna=True):
        count = len(season_df)
        if count == 0:
            winners_pm = unforced_pm = aces_pm = errors_forced_pm = double_faults_pm = None
        else:
            winners_pm = pd.to_numeric(season_df["Winners"], errors="coerce").fillna(0).sum() / count
            unforced_pm = pd.to_numeric(season_df["Unforced Errors"], errors="coerce").fillna(0).sum() / count
            aces_pm = pd.to_numeric(season_df["Aces"], errors="coerce").fillna(0).sum() / count
            errors_forced_pm = pd.to_numeric(season_df["Errors Forced"], errors="coerce").fillna(0).sum() / count
            double_faults_pm = pd.to_numeric(season_df["Double Faults"], errors="coerce").fillna(0).sum() / count

        stats_lines.append(
            "| {season} | {winners} | {unforced} | {aces} | {errors_forced} | {double_faults} |".format(
                season=season,
                winners=fmt_per_match(winners_pm),
                unforced=fmt_per_match(unforced_pm),
                aces=fmt_per_match(aces_pm),
                errors_forced=fmt_per_match(errors_forced_pm),
                double_faults=fmt_per_match(double_faults_pm),
            )
        )

    season_stats_md = "\n".join(stats_lines) if matches_played_total else "> No matches found."

    finals_lines = []
    finals_lines.append("| Season | Final | Winners | Unforced Errors | Aces | Errors Forced | Finals MVP Votes |")
    finals_lines.append("|---:|---|---:|---:|---:|---:|---:|")

    if finals_df is not None and not finals_df.empty:
        for _, r in finals_df.iterrows():
            finals_lines.append(
                "| {season} | {final} | {winners} | {unforced} | {aces} | {errors_forced} | {votes} |".format(
                    season=fmt_stat(r.get("Season")),
                    final=fmt_stat(r.get("Final")),
                    winners=fmt_stat(r.get("Winners")),
                    unforced=fmt_stat(r.get("Unforced Errors")),
                    aces=fmt_stat(r.get("Aces")),
                    errors_forced=fmt_stat(r.get("Errors Forced")),
                    votes=fmt_stat(r.get("Finals MVP Votes")),
                )
            )

    finals_table_md = "\n".join(finals_lines) if finals_df is not None and not finals_df.empty else "> No finals matches found."

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

    matches_table_md = "\n".join(table_lines) if matches_played_total else "> No matches found."

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

| Matches | Record | MVP Votes | Finals MVP Votes | BOGs |
|---|---|---|---|---|
| **{matches_played_total}**<br>fill-ins: {fillin_count} | **{wins}-{losses}**<br>win rate: {fmt_pct(win_rate)} | **{votes_total}** | **{finals_votes_total}** | **{bog_count}** |

## Regular Season Summary

{season_summary_md}

## Regular Season Stats

{season_stats_md}

## Finals Statistics

{finals_table_md}

## Matches

{matches_table_md}
"""
    out_path.write_text(qmd, encoding="utf-8")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--match_stats", type=str, default=None,
                        help="Path to match_stats.csv (default: ../data/match_stats.csv relative to this script)")
    parser.add_argument("--finals_stats", type=str, default=None,
                        help="Path to match_stats_finals.csv (default: ../data/match_stats_finals.csv relative to this script)")
    parser.add_argument("--players_csv", type=str, default=None,
                        help="Path to players.csv (default: ../data/players.csv relative to this script)")
    parser.add_argument("--outdir", type=str, default=None,
                        help="Output directory for player QMDs (default: ../players relative to this script)")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    match_path = Path(args.match_stats) if args.match_stats else (here / ".." / "data" / "match_stats.csv")
    finals_path = Path(args.finals_stats) if args.finals_stats else (here / ".." / "data" / "match_stats_finals.csv")
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

    finals_df = pd.DataFrame()
    if finals_path.exists():
        finals_df = pd.read_csv(finals_path)
        finals_df.columns = [c.strip() for c in finals_df.columns]
        unnamed_cols = [c for c in finals_df.columns if c.startswith("Unnamed") or not c]
        if unnamed_cols:
            finals_df = finals_df.drop(columns=unnamed_cols)

        finals_canon = finals_df["Player"].astype(str).apply(canonical_player_name)
        finals_df["canonical_player"] = finals_canon.apply(lambda t: t[0])
        finals_df["is_fill_in"] = finals_canon.apply(lambda t: t[1])

    players_info = load_players_csv(players_path)

    # Ensure players.csv is keyed on canonical names
    players_info["name"] = players_info["name"].astype(str).apply(lambda s: canonical_player_name(s)[0])

    # Generate one page per unique player who appeared in match_stats
    unique_players = sorted(df["canonical_player"].dropna().astype(str).unique().tolist())

    n = 0
    for pname in unique_players:
        pslug = slugify(pname)
        pmatches = build_match_rows_for_player(df, pname)
        pfinals = build_finals_rows_for_player(finals_df, pname) if not finals_df.empty else pd.DataFrame()
        out_path = out_dir / f"{pslug}.qmd"
        render_player_qmd(pname, pslug, pmatches, pfinals, players_info, out_path)
        n += 1

    print(f"Generated {n} player pages in: {out_dir}")

if __name__ == "__main__":
    main()
