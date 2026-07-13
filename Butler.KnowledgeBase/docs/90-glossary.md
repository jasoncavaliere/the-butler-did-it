---
name:          90-glossary
title:         Glossary
category:      Reference
lifecycle:     Living
owner:         agent-managed
last-reviewed: 2026-07-13
audience:      Anyone reading or writing Butler docs
keywords:      [glossary, terms, definitions, vocabulary, hub, household model, tap-to-claim, store connector, assisted cart, novelty cliff, north star, BYO-tablet, participant, organizer]
related:       [00-overview, 10-product-vision]
published-to:
---

# Glossary

> **In one line:** The shared vocabulary of Butler, defined once here so no other article has to re-explain it.

These are the terms Butler docs use. Each is a sentence or two. Where a term is a strategic concept, the definition links to where it is argued in the [Product Vision](10-product-vision.md). If you add a term anywhere in the wiki, define it here rather than in place.

## Butler

The product: a shared family operating system for the home. It runs on a shared tablet and divides household work fairly, models the home, and executes real-world tasks like grocery ordering. Working repo name is `the-butler-did-it`. See the [Product Vision](10-product-vision.md).

## The Hub

The shared tablet mounted in a common room that is Butler's primary surface. It is always on, glanceable, and offline-tolerant. The hub is a deliberate alternative to a phone app, chosen to make whole-family participation ambient rather than something every member has to install. See [The product: a shared hub](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app).

## Household Model

The structured twin of a home: rooms, then the people in it, then the chores that attach to both. It is the data spine every Butler capability reads from and writes to, and it is Butler's durable moat because it gets richer the longer a family uses it. See [The wedge and the expansion story](10-product-vision.md#the-wedge-and-the-expansion-story).

## Household Organizer

The one account that holds real credentials and billing for a household, and the first champion of Butler inside a family (usually the person carrying the mental load). Sensitive actions - billing, teardown, large purchases - sit behind the organizer's authentication. Contrast with a [Participant](#participant).

## Participant

Any member of the household who uses the hub through a lightweight [tap-to-claim](#tap-to-claim) profile with no password. Participants see and complete what is theirs but cannot take sensitive actions, which stay behind the [Household Organizer](#household-organizer). Kids are participants with a simple parent/child flag.

## Tap-to-claim

The hub identity model: each person taps their name to claim their profile, no password required. It is what makes participation frictionless, and it carries a deliberate trade-off - the hub trusts whoever is standing at it - which is why costly and irreversible actions stay behind the organizer's auth. See [Identity decision](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app).

## Chore Mapping and Fair Assignment

Butler's wedge: mapping the household's chores and dividing them fairly across members instead of leaving them in one person's head. It is the most emotionally resonant way into the product ("stop the nagging, make it fair") and the source of the daily habit loop. See [The wedge and the expansion story](10-product-vision.md#the-wedge-and-the-expansion-story).

## Store Connector

The generic abstraction behind Butler's grocery execution. Each connector implements ordering for a specific store or aggregator; the product experience stays the same while the connector swaps underneath. It exists because retailers like HEB have no public consumer API, and at maturity it becomes a user-facing surface where a household picks its own set of stores. See [The store-connector ladder](10-product-vision.md#real-world-execution-the-store-connector-ladder).

## Assisted Cart

The v1 grocery flow: voice or taps fill a cart, and a human confirms the final order. It is the first rung of the store-connector ladder, chosen because voice-shopping conversion is thin and because it keeps a person in control of spending money. Later rungs move toward hands-off ordering. See [The store-connector ladder](10-product-vision.md#real-world-execution-the-store-connector-ladder).

## Novelty Cliff

The well-observed pattern where a family app loses engagement once the newness wears off - the reason chore apps churn. Butler's answer is to make the daily habit a glance (a pull) rather than a chore (a push). The pattern is qualitative but consistent with the general collapse of daily active users by roughly day 90 across apps. See [The retention thesis](10-product-vision.md#the-retention-thesis).

## North Star

Butler's single top-line metric: weekly active households (not users). It measures the multiplayer habit, which is the whole game. The proposed v1 target is 50 percent of onboarded households still weekly-active at month 3, paired with fairness, execution, and retention guardrails. See [What winning looks like](10-product-vision.md#what-winning-looks-like).

## BYO-tablet

Bring your own tablet: the v1 hardware decision. Butler ships as a web app and installable PWA (progressive web app) that runs on any Android tablet or iPad a family already owns, rather than on Butler-made hardware. It is offline-tolerant so the last-known week stays readable with no network. See [Hardware and offline decision](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app).

## Related

- [Overview](00-overview.md) - what Butler is and how this knowledge base is organized.
- [Product Vision](10-product-vision.md) - where these terms are argued in full.
