# scratch/update_nav_labels.py

with open('index.html', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace plain text button labels with span.nav-btn-label
c = c.replace(
    '<line x1="12" y1="15" x2="12" y2="3"></line></svg>\n          Install App',
    '<line x1="12" y1="15" x2="12" y2="3"></line></svg>\n          <span class="nav-btn-label">Install App</span>'
)
c = c.replace(
    '<line x1="5" y1="12" x2="19" y2="12"></line></svg>\n          New Card',
    '<line x1="5" y1="12" x2="19" y2="12"></line></svg>\n          <span class="nav-btn-label">New Card</span>'
)
c = c.replace(
    '<line x1="12" y1="2" x2="12" y2="15"></line></svg>\n          Backup & Share',
    '<line x1="12" y1="2" x2="12" y2="15"></line></svg>\n          <span class="nav-btn-label">Backup & Share</span>'
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(c)

print('Updated index.html button labels')

# Now update css/responsive.css
with open('css/responsive.css', 'r', encoding='utf-8') as f:
    resp = f.read()

# Replace the @media (max-width: 860px) block with enhanced responsive rules
old_860_rule = """@media (max-width: 860px) {
  .nav-container {
    padding: 0 0.75rem;
    gap: 0.45rem;
  }
  .brand-name {
    font-size: 1.18rem;
  }
  .brand-icon {
    width: 32px;
    height: 32px;
  }
  .nav-menu {
    gap: 0.25rem;
  }
  .nav-link {
    padding: 0.35rem 0.55rem;
    font-size: 0.82rem;
  }
  .nav-actions .btn-sm {
    padding: 0.35rem 0.5rem;
  }
}"""

new_860_rule = """@media (max-width: 860px) {
  .nav-container {
    padding: 0 0.75rem;
    gap: 0.45rem;
  }
  .brand-name {
    font-size: 1.18rem;
  }
  .brand-icon {
    width: 32px;
    height: 32px;
  }
  .nav-menu {
    gap: 0.25rem;
  }
  .nav-link {
    padding: 0.35rem 0.55rem;
    font-size: 0.82rem;
  }
  .nav-actions .btn-sm {
    padding: 0.35rem 0.5rem;
  }
  #nav-btn-install .nav-btn-label,
  #nav-btn-share .nav-btn-label {
    display: none;
  }
  #nav-btn-install,
  #nav-btn-share {
    width: 36px;
    height: 36px;
    padding: 0;
    justify-content: center;
  }
}

@media (max-width: 680px) {
  #nav-btn-new-card .nav-btn-label {
    display: none;
  }
  #nav-btn-new-card {
    width: 36px;
    height: 36px;
    padding: 0;
    justify-content: center;
  }
}"""

resp = resp.replace(old_860_rule, new_860_rule)
with open('css/responsive.css', 'w', encoding='utf-8') as f:
    f.write(resp)

print('Updated css/responsive.css')
