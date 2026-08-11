# -*- coding: utf-8 -*-
# Injected into every dashboard at build time. One source, six dashboards.
MOBILE = r"""
<style id="hw-mobile">
/* ------------------------------------------------------------------
   Small screens. These dashboards are wide by nature - a grid of dates,
   a table of forty columns - so the tables keep scrolling sideways and
   everything around them stops competing for the width instead.
   Written generically so it covers all six without touching each one.
   ------------------------------------------------------------------ */
@media (max-width: 900px){
  /* toolbars and header rows wrap rather than squeeze */
  .toolbar, .filter-bar, .app-header, .header-top, .header-meta,
  .tabs, .page-tabs, .kpis, .actions, .btnrow, .controls{
    flex-wrap: wrap !important;
    gap: 8px !important;
  }
  .toolbar, .filter-bar{ padding: 10px 12px !important; }

  /* anything that scrolls keeps momentum on touch */
  .table-scroll, .tablewrap, .scroll, .grid-scroll, .wrap-scroll{
    -webkit-overflow-scrolling: touch;
    overflow-x: auto;
  }
  /* a bare table with no wrapper still needs to scroll rather than crush */
  table{ max-width: none; }

  /* tab strips scroll instead of stacking into a wall */
  .tabs, .page-tabs, .subtabs, .seg{
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap !important;
  }
  .tab, .page-tab, .subtab, .seg > *{ white-space: nowrap; flex: 0 0 auto; }

  /* card grids reflow to whatever fits */
  .kpis, .kpi-row, .cards, .card-grid, .grid, .stat-row, .ins-grid, .pay-grid{
    display: grid !important;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important;
    gap: 8px !important;
  }

  /* dialogs stop being desktop-width boxes */
  .modal .box, .modal-card, .um-card, .ui-ask, .gate-card, .slip, .imp-card{
    width: 94vw !important;
    max-width: 94vw !important;
    max-height: 88vh;
    overflow-y: auto;
  }
  /* dropdown panels too */
  .month-dropdown, .imp-menu, .menu, .popover{
    max-width: 94vw !important;
    left: 4px !important;
    right: auto !important;
  }

  /* inputs at 16px or iOS zooms the page on focus */
  input, select, textarea{ font-size: 16px !important; }

  /* long headings stop pushing the layout wider than the screen */
  h1{ font-size: 17px !important; }
  h2{ font-size: 15px !important; }
  body{ overflow-x: hidden; }
}

@media (max-width: 560px){
  /* on a phone the subtitle and decoration go, the numbers stay */
  .app-title span, .brand-text p, .subtitle, .muted-sub{ display: none !important; }
  .kpis, .kpi-row, .cards, .card-grid, .stat-row{
    grid-template-columns: 1fr 1fr !important;
  }
  .ins-grid, .pay-grid, .slip-grid, .ed-body{ grid-template-columns: 1fr !important; }
  .kpi .v, .card .v, .stat .v{ font-size: 17px !important; }
  /* buttons become tappable rather than dense */
  button, .btn, .tbtn, .month-btn{ min-height: 36px; }
  table td, table th{ padding: 6px 8px !important; font-size: 11.5px !important; }
}
</style>
"""
