# apply_fix.py

# 1. Update index.html
with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if 'id="nav-btn-settings"' in line:
        new_lines.append(line)
        new_lines.append('          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n')
        new_lines.append('            <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"></path>\n')
        new_lines.append('            <circle cx="12" cy="12" r="3"></circle>\n')
        new_lines.append('          </svg>\n')
    elif '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle>' in line:
        # skip old svg line
        continue
    else:
        new_lines.append(line)

with open('index.html', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('index.html updated')

# 2. Update css/components.css
with open('css/components.css', 'r', encoding='utf-8') as f:
    comp = f.read()

target_btn_icon = """.btn-icon {
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: var(--radius-md);
}"""

replacement_btn_icon = """.btn-icon {
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}"""

comp = comp.replace(target_btn_icon, replacement_btn_icon)
with open('css/components.css', 'w', encoding='utf-8') as f:
    f.write(comp)
print('css/components.css updated')

# 3. Update css/main.css
with open('css/main.css', 'r', encoding='utf-8') as f:
    main_css = f.read()

target_nav_actions = """.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}"""

replacement_nav_actions = """.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-shrink: 0;
}"""

main_css = main_css.replace(target_nav_actions, replacement_nav_actions)
with open('css/main.css', 'w', encoding='utf-8') as f:
    f.write(main_css)
print('css/main.css updated')

# 4. Update css/responsive.css
with open('css/responsive.css', 'r', encoding='utf-8') as f:
    resp = f.read()

nav_rules = """
@media (max-width: 1050px) {
  .nav-container {
    padding: 0 1rem;
    gap: 0.6rem;
  }
  .nav-actions {
    gap: 0.45rem;
  }
  .nav-actions .btn-sm {
    padding: 0.35rem 0.6rem;
    font-size: 0.82rem;
  }
}

@media (max-width: 860px) {
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
}
"""

if '@media (max-width: 1050px)' not in resp:
    resp = resp.replace('@media (max-width: 900px) {', nav_rules + '\n@media (max-width: 900px) {')
    with open('css/responsive.css', 'w', encoding='utf-8') as f:
        f.write(resp)
    print('css/responsive.css updated')
