(function () {
  const mount = document.querySelector("[data-site-nav]");
  if (!mount) {
    return;
  }

  const root = mount.getAttribute("data-root") || "";
  const includeShare = mount.getAttribute("data-include-share") === "true";
  const links = [
    { href: "index.html", label: "Home" },
    { href: "how-it-works.html", label: "How it Works" },
    { href: "donate.html", label: "Donate" }
  ];

  if (includeShare) {
    links.push({ href: "share-images.html", label: "Share Images" });
  }

  const nav = document.createElement("nav");
  nav.className = "top-nav";
  nav.setAttribute("aria-label", "Main navigation");

  const normalizePath = (value) => value.replace(/\\/g, "/").replace(/\/+/g, "/");
  const currentPath = normalizePath(window.location.pathname);

  for (const linkDef of links) {
    const a = document.createElement("a");
    a.href = `${root}${linkDef.href}`;
    a.textContent = linkDef.label;

    const targetPath = normalizePath(new URL(a.href, window.location.origin).pathname);
    if (currentPath === targetPath || (linkDef.href === "index.html" && currentPath.endsWith("/"))) {
      a.setAttribute("aria-current", "page");
    }

    nav.appendChild(a);
  }

  mount.replaceWith(nav);
})();
