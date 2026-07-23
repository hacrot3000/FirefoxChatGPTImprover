# Phase 17 v0.17.1 — Header action layout hotfix

The compact controls and Help button for **Tabs and sessions** and **New target element** now share one flex action container in each group heading. Help is always the last item on the right.

This removes the former absolute-position overlap that could hide the Start/Pause or target-click quick controls. Compact controls remain visible only while their group is collapsed; Refresh and Help remain available in both states.
