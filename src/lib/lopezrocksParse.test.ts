import { describe, expect, it } from "vitest";
import {
  LrNotAPage,
  classifyHref,
  decodeEntities,
  linkFromQuery,
  parseHtml,
  parseLopezRocks,
  readerHref,
  siteHref,
  tailMeta,
  upstreamPath,
  type LrLink,
  type LrRun,
} from "./lopezrocksParse";

/**
 * LopezRocks pages, read as data.
 *
 * The HTML here is SYNTHETIC — the site's template, copied tag for tag, with
 * invented posts. Real pages carry real islanders' names and phone numbers,
 * which do not belong in this repository.
 *
 * What matters most, in order:
 *   1. the address bar can never make the server fetch a page this module did
 *      not build (the query checks);
 *   2. nothing from a post reaches the app as markup (the safety checks);
 *   3. each page shape reads the way the site means it.
 */

/** The frame every LopezRocks page shares: the section menu, then #main. */
function page(title: string, main: string, menu = SECTIONS): string {
  return `<!DOCTYPE html lang="en-US">
<html><head><title>LopezRocks - ${title}</title>
<link rel="stylesheet" type="text/css" href="style.css?v=7.1">
</head><body><div id="screen"><div id="site"><div id="left-side"><div id="left-menu">${menu}</div></div>
<div id="right-side"><div style="float: left;padding-left: 2vw;"><div><a href="index.php" class="banner" title="Go Home">L O P E Z R O C K S</a></div><div class="subbanner" style="padding-bottom: 1vw;">A Community Website by Lopez Island</div></div>
<div id="main">${main}</div></div><div id="footer"><div class="footer">1 visits since 2009</div></div></div></div></body>
<script>var x = "<div id='main'>not me</div>";</script></html>`;
}

const SECTIONS = [
  ["9", "News and Views"],
  ["11", "Calendar"],
  ["21", "Offered"],
  ["36", "Let's Talk"],
]
  .map(
    ([h, t]) =>
      `<div style="padding-bottom: 0.6vw;padding-left: 3vw;"><a class="menu" href="page.php?handle=${h}" target="_top" title="Go to ${t}">${t.replace("'", "&#039;")}</a></div>`,
  )
  .join("");

/** A section's two heading blocks: the "Add a New Item" picture and the name. */
function head(handle: string, name: string, extra = ""): string {
  return `<div style="float: left;padding-left: 1.0vw;padding-top: 1.5vw;width: 25%;"><form method="post" action="page.php">
<input type="hidden" name="menu_handle" value="${handle}"><input type="hidden" name="type" value="login">
<div id="text-center" class="small"><input type="image" src="images/offered.png" alt="Add a New Item" style="height: 8vw;"><br>
<a href="page.php?type=login&menu_handle=${handle}" title="Click here to log in add a new item" class="image">Add a New Item</a></div></form></div>
<div style="float: left;padding-top: 1.5vw;width: 25%;"><div class="h2" style="padding-left: 2%;">${name}</div>${extra}</div>`;
}

function textOf(runs: LrRun[]): string {
  return runs.map((r) => r.text).join("");
}

describe("the HTML reader", () => {
  it("reads attributes with no space between them", () => {
    const root = parseHtml(`<div id="text-center"style="clear: both;">x</div>`);
    const div = root.kids[0] as { attrs: Record<string, string> };
    expect(div.attrs).toEqual({ id: "text-center", style: "clear: both;" });
  });

  it("gives a stray cell the row the page left out", () => {
    const html = page(
      "Useful Links",
      `${head("81", "Useful Links")}<div id="div-center"><table><tbody>
<tr><td class="li-keyword">Arts</td><td class="li-title">First Studio</td><td class="li-href"><a href="http://first.example" target="_blank">first.example</a></td></tr>
<td></td><td class="li-title">Second Studio</td><td class="li-href"><a href="https://second.example/" target="_blank">second.example</a></td></tr>
</tbody></table></div>`,
    );
    const p = parseLopezRocks(html).page;
    expect(p.kind).toBe("list");
    if (p.kind !== "list") return;
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].rows.map((r) => [r.title, r.sub])).toEqual([
      ["First Studio", "first.example"],
      ["Second Studio", "second.example"],
    ]);
  });

  it("decodes the entities the site writes", () => {
    expect(decodeEntities("Jules&#039; &quot;jewelry&quot; &amp; more &copy; &#x2019; &bogus;")).toBe(
      "Jules' \"jewelry\" & more © ’ &bogus;",
    );
  });

  it("ignores what is inside a script", () => {
    const r = parseLopezRocks(page("Offered", `${head("21", "Offered")}<div id="div-center"></div>`));
    expect(r.title).toBe("Offered");
  });
});

describe("links", () => {
  it("classifies the site's own addresses", () => {
    expect(classifyHref("index.php")).toEqual({ kind: "home" });
    expect(classifyHref("page.php?handle=21")).toEqual({ kind: "section", handle: "21" });
    expect(classifyHref("page.php?handle=21&type=postit&shuffle=1")).toEqual({
      kind: "section",
      handle: "21",
      type: "postit",
      shuffle: "1",
    });
    expect(
      classifyHref("page.php?type=item&item_handle=1790484556&menu_type=postit&return=21&offset=0&shuffle="),
    ).toEqual({ kind: "item", item: "1790484556", type: "postit", ret: "21" });
    expect(
      classifyHref("page.php?type=item&menu_type=forum&comment_handle=17&item_handle=18&menu_handle=36#read17"),
    ).toEqual({ kind: "item", item: "18", type: "forum", menuHandle: "36", comment: "17" });
  });

  it("sends sign-in, posting and messaging to the site itself", () => {
    expect(classifyHref("page.php?type=login&menu_handle=21")).toEqual({
      kind: "site",
      href: "https://lopezrocks.org/page.php?type=login&menu_handle=21",
    });
    expect(classifyHref("https://www.lopezrocks.org/page.php?type=about")).toEqual({
      kind: "site",
      href: "https://lopezrocks.org/page.php?type=about",
    });
  });

  it("keeps outside links, mail and phone, and drops script links", () => {
    expect(classifyHref("http://www.kloi.org/")).toEqual({ kind: "external", href: "http://www.kloi.org/" });
    expect(classifyHref("mailto: info@example.org")).toEqual({ kind: "external", href: "mailto:info@example.org" });
    expect(classifyHref("javascript:alert(1)")).toBeNull();
    expect(classifyHref("#top")).toBeNull();
    expect(classifyHref("")).toBeNull();
  });

  it("round-trips every page it draws through the app's own address", () => {
    const links: LrLink[] = [
      { kind: "home" },
      { kind: "section", handle: "11", offset: "2026-10-12" },
      { kind: "section", handle: "21", type: "postit", offset: "1789834535" },
      { kind: "item", item: "1789066349", type: "calendar", ret: "11", offset: "2026-09-27" },
      { kind: "item", item: "18", type: "forum", menuHandle: "36", comment: "17" },
    ];
    for (const link of links) {
      const href = readerHref(link);
      const q = Object.fromEntries(new URL(href, "https://app.example").searchParams);
      expect(linkFromQuery(q), href).toEqual(link);
    }
  });

  it("builds the request the site's own forms send", () => {
    expect(upstreamPath({ kind: "section", handle: "21", type: "postit", offset: "1789834535" })).toBe(
      "page.php?type=postit&handle=21&shuffle=&offset=1789834535",
    );
    expect(upstreamPath({ kind: "section", handle: "11", offset: "2026-10-12" })).toBe(
      "page.php?handle=11&offset=2026-10-12",
    );
    expect(upstreamPath({ kind: "item", item: "5", type: "postit", ret: "21" })).toBe(
      "page.php?type=item&item_handle=5&menu_type=postit&return=21",
    );
    expect(upstreamPath({ kind: "site", href: "https://lopezrocks.org/page.php?type=login" })).toBeNull();
    expect(siteHref({ kind: "section", handle: "21" })).toBe("https://lopezrocks.org/page.php?handle=21");
  });

  it("turns any malformed address into the home page, never a fetch", () => {
    for (const q of [
      { s: "21/../../etc" },
      { s: "https://evil.example" },
      { i: "1;drop" },
      { i: "" },
      { s: ["21", "22"], t: "../x" },
      {},
    ]) {
      const link = linkFromQuery(q);
      const path = upstreamPath(link) ?? "";
      expect(path === "index.php" || /^page\.php\?[a-z_]+=[\w-]*(&[a-z_]+=[\w-]*)*$/.test(path), path).toBe(true);
    }
    expect(linkFromQuery({ s: "21/../../etc" })).toEqual({ kind: "home" });
    expect(linkFromQuery({ s: "21", t: "login", o: "<b>" })).toEqual({ kind: "section", handle: "21" });
  });

  it("reads a post's trailing facts", () => {
    expect(tailMeta(" (Sep 26)")).toEqual(["Sep 26"]);
    expect(tailMeta("(By Ann on Sep 9, 2026) - 1 comment")).toEqual(["By Ann on Sep 9, 2026", "1 comment"]);
    expect(tailMeta("  ")).toEqual([]);
  });
});

describe("page shapes", () => {
  it("reads the section menu from every page", () => {
    const r = parseLopezRocks(page("Offered", `${head("21", "Offered")}<div id="div-center"></div>`));
    expect(r.sections).toEqual([
      { handle: "9", title: "News and Views" },
      { handle: "11", title: "Calendar" },
      { handle: "21", title: "Offered" },
      { handle: "36", title: "Let's Talk" },
    ]);
  });

  it("reads a listing: keyword groups, dates, photos, the Next button", () => {
    const row = (kw: string, id: string, t: string, tail: string, photo = false) =>
      `<tr><td class="pi-keyword">${kw}</td><td class="pi-href"><a href="page.php?type=item&item_handle=${id}&menu_type=postit&return=21&offset=0&shuffle=">${t}</a> ${tail}${
        photo ? `<img src="images/image.png" title="Picture included" style="height: 2vw;">` : ""
      }</td></tr>`;
    const html = page(
      "Offered",
      `${head(
        "21",
        "Offered",
        `<div class="small"><a href="page.php?handle=21&type=postit&shuffle=1" class="image" title="Click here to show by date">Change Display</a></div>`,
      )}<div id="div-center" style="clear: both;padding: 2vw;"><table class="postit"><tbody>
${row("*Take It*", "101", "Outdoor Lights", "(Sep 26)")}
${row("", "102", "Bubble Wrap 12&#8221;w", "(Sep 25)", true)}
${row("Automotive", "103", "1974 Pickup", "(Sep 24)")}
<tr><td class="pi-keyword"></td><td class="pi-href">Continues on next page...</td></tr>
</tbody></table>
<form method="post" action="page.php"><input type="hidden" name="type" value="postit"><input type="hidden" name="handle" value="21">
<input type="hidden" name="shuffle" value=""><input type="hidden" name="offset" value="1789834535">
<button type="submit" class="click" title="Click to next">Next</button></form></div>`,
    );
    const p = parseLopezRocks(html).page;
    expect(p.kind).toBe("list");
    if (p.kind !== "list") return;
    expect(p.head.title).toBe("Offered");
    expect(p.head.actions).toEqual([
      { label: "Add a New Item", link: { kind: "site", href: "https://lopezrocks.org/page.php?type=login&menu_handle=21" } },
      { label: "Show by date", link: { kind: "section", handle: "21", type: "postit", shuffle: "1" } },
    ]);
    expect(p.groups.map((g) => [g.title, g.rows.map((r) => [r.title, r.meta])])).toEqual([
      ["Take It", [["Outdoor Lights", ["Sep 26"]], ["Bubble Wrap 12”w", ["Sep 25", "Photo"]]]],
      ["Automotive", [["1974 Pickup", ["Sep 24"]]]],
    ]);
    expect(p.pager).toEqual([
      { label: "Next page", link: { kind: "section", handle: "21", type: "postit", offset: "1789834535" } },
    ]);
  });

  it("does not make a group of a keyword cell that holds the row's own link", () => {
    const row = (id: string, name: string, sum: string) =>
      `<tr><td style="width: 5%;"></td><td class="di-keyword"><a href="page.php?type=item&item_handle=${id}&menu_type=directory&return=70&offset=0">${name}</a></td><td class="di-summary">${sum}</td></tr>`;
    const html = page(
      "Farm to Market",
      `${head("70", "Farm to Market")}<div id="div-center"><table class="directory"><tbody>${row("1", "Blue Farm", "Berries")}${row("2", "Green Farm", "Greens")}</tbody></table></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "list") throw new Error(p.kind);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].rows.map((r) => [r.title, r.sub])).toEqual([
      ["Blue Farm", "Berries"],
      ["Green Farm", "Greens"],
    ]);
  });

  it("reads a discussion list's author and comment count", () => {
    const html = page(
      "Let's Talk",
      `${head("36", "Let's Talk")}<div id="div-center"><table class="forum"><tbody>
<tr><td class="fm-date">Sep 20, 2026</td><td class="fm-href"><a href="page.php?type=item&item_handle=9&menu_type=forum&return=36&offset=2026-09-27">Park comments</a> (By Park Group on Sep 17, 2026) - 1 comment</td></tr>
</tbody></table></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "list") throw new Error(p.kind);
    expect(p.groups[0].rows[0].meta).toEqual(["Sep 20, 2026", "By Park Group on Sep 17, 2026", "1 comment"]);
  });

  it("reads the calendar day by day", () => {
    const day = (label: string, events: [string, string, string][]) =>
      `<div style="float: left;width: 20%"><div class="tabs" id="text-center">${label}</div><div style="padding-left: 0.5vw;">${events
        .map(
          ([id, time, t]) =>
            `<div class="p"><a href="page.php?type=item&menu_type=calendar&offset=2026-09-27&return=11&item_handle=${id}">${time}:</a><a href="page.php?type=item&menu_type=calendar&offset=2026-09-27&return=11&item_handle=${id}" style="border-bottom: 0px;"> ${t}</a></div>`,
        )
        .join("")}</div></div>`;
    const html = page(
      "Calendar",
      `${head("11", "Calendar")}<div id="div-center"><div style="clear: both;width: 100%;">${day("Sun, Sep 27", [
        ["1", "10:30am", "Meditation"],
        ["2", "4:00pm", "Mass"],
      ])}${day("Mon, Sep 28", [])}</div>
<form method="post" action="page.php"><input type="hidden" name="handle" value="11" /><input type="hidden" name="return" value="" />
<input type="hidden" name="offset" value="2026-10-12" /><button type="submit" class="click">Next</button></form></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "calendar") throw new Error(p.kind);
    expect(p.days.map((d) => [d.label, d.monthDay, d.events.map((e) => [e.time, e.title])])).toEqual([
      ["Sun, Sep 27", "Sep 27", [["10:30am", "Meditation"], ["4:00pm", "Mass"]]],
      ["Mon, Sep 28", "Sep 28", []],
    ]);
    expect(p.pager[0].link).toEqual({ kind: "section", handle: "11", offset: "2026-10-12" });
  });

  it("reads one post: who, how to reach them, the photos and the way back", () => {
    const html = page(
      "Item",
      `<div style="float: left;padding-top: 1.5vw;width: 25%;"></div>
<div id="div-center" style="clear: both;padding: 2vw;">
<div style="float: left;width: 25%;margin-top: 0vw;"><div id="text-center" style="background-color:  #DCDCDC;margin-top: 1vw;padding: 0.8vw;">
<div class="p">Posted by Pat Example<br>Lopez Island<br>Sep 25, 2026</div>
<div class="p" style="padding-top: 1vw;">360.555.0100</div>
<div class="p">360.555.0100 (cell)</div>
<div style="padding-top: 1vw;"><a href="page.php?type=login&continue=message&menu_handle=21&item_handle=5" class="image"><img src="images/send message.png"></a></div>
<div id="text-center" class="small"><a href="page.php?type=login&continue=message&menu_handle=21&item_handle=5" class="image">Send a Message</a></div>
<div style="padding-top: 2vw;"id="image-center"><a href="page.php?type=forward&return=item&menu_handle=21&item_handle=5" title="Email the link to this item to somebody" class="image"><img src="images/share this.png"></a></div>
<div id="text-center" class="small"><a href="page.php?type=forward&return=item&menu_handle=21&item_handle=5" class="image">Share this</a></div>
</div></div>
<div style="float: left;width: 72%;margin-left: 3%;"><div id="text-left" class="h3">Kerosene stove</div>
<div style="float: left;width: 56%;"><div id="text-left" style="padding-top: 1vw;" class="h5">September 25, 2026</div>
<div id="text-left" class="p" style="padding-top: 1vw;">Works well.<br>
<br> Near the Village.</div></div>
<div style="float: left;width: 42%;padding-left: 2%;"><div style="width: 100%;padding-top: 2vw;"><img id="image-center" src="postit/1.jpg" style="width: 100%;"></div></div>
</div>
<div style="padding-bottom: 2vw;clear: both;"></div>
<form method="post" action="page.php"><input type="hidden" name="menu_type" value="postit"><input type="hidden" name="offset" value="0">
<input type="hidden" name="shuffle" value=""><input type="hidden" name="handle" value="21">
<button type="submit" class="click" title="Go back to Offered">Back</button></form></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "item") throw new Error(p.kind);
    const it = p.item;
    expect(it.title).toBe("Kerosene stove");
    expect(it.details).toEqual(["September 25, 2026"]);
    expect(it.body.map(textOf)).toEqual(["Works well.\n\nNear the Village."]);
    expect(it.images).toEqual([{ src: "https://lopezrocks.org/postit/1.jpg" }]);
    expect(it.person).toEqual({
      lines: ["Posted by Pat Example", "Lopez Island", "Sep 25, 2026"],
      phone: "360.555.0100",
      extras: [],
    });
    expect(it.actions.map((a) => [a.label, a.link.kind])).toEqual([
      ["Send a Message", "site"],
      ["Share", "site"],
    ]);
    expect(it.back).toEqual({ label: "Back to Offered", link: { kind: "section", handle: "21" } });
  });

  it("reads a discussion's comments and its Agree count", () => {
    const box = (who: string, agree: string) =>
      `<div style="float: left;width: 25%;margin-top: 0vw;"><div id="text-center" style="background-color:  #DCDCDC;padding: 0.8vw;">
<div class="p" style="color: black;">${who}<br>Sep 12, 2026</div>
<div style="width: 50%;float: left;"><a href="page.php?menu_handle=36&type=login&continue=comment&parent_handle=9" class="image" title="Log in to comment on this"><img src="images/comment.png"></a></div>
<div style="float:left; width: 50%;"><a href="page.php?type=login&continue=agree&voted=1&parent_handle=9" class="image" title="Log in if you want to agree with this"><img src="images/agree.png"></a><div class="small" id="text=center">${agree}</div></div>
</div></div>`;
    const html = page(
      "Item",
      `<div id="div-center">${box("Started by Sam Example", "5")}
<div style="float: left;width: 72%;margin-left: 3%;"><div id="text-left" class="h3">A question</div>
<div style="float: left;width: 70%;"><div class="h5">September 12, 2026</div><div class="p">The post.</div></div></div>
<div style="padding-bottom: 2vw;clear: both;"></div><div style="width: 100%;"><img src="images/comment.jpg"></div>
<div><a name="read1"></a></div>${box("Comment by Lee Example", "2")}
<div style="float: left;width: 72%;margin-left: 3%;"><div style="float: left;width: 70%;"><div class="p">A reply ... <a href="page.php?type=item&menu_type=forum&comment_handle=1&item_handle=9&menu_handle=36#read1">Read All</a></div></div></div>
</div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "item") throw new Error(p.kind);
    expect(p.item.person?.agree).toBe("5");
    expect(p.item.actions.map((a) => a.label)).toEqual(["Comment", "Agree"]);
    expect(p.item.comments).toHaveLength(1);
    expect(p.item.comments[0].by.lines).toEqual(["Comment by Lee Example", "Sep 12, 2026"]);
    const reply = p.item.comments[0].body[0];
    expect(textOf(reply)).toBe("A reply ... Read All");
    expect(reply[1].link).toEqual({ kind: "item", item: "9", type: "forum", menuHandle: "36", comment: "1" });
  });

  it("reads a news story's by-line, lead and the Other News column", () => {
    const html = page(
      "News and Views",
      `${head("9", "News and Views")}<div id="div-center"><div style="float: left;width: 25%;"><div id="text-center" style="background-color:  #DCDCDC;">
<div class="h5">Other News</div>
<div class="p"><a href="page.php?type=item&return=9&menu_type=news&menu_handle=9&item_handle=2">Sep 24, 2026</a>: <a href="page.php?type=item&return=9&menu_type=news&menu_handle=9&item_handle=2" class="image">Older story</a></div>
</div></div>
<div style="float: left;width: 72%;margin-left: 3%;"><div id="text-left" class="h3">Council meeting</div>
<div style="float: left;width: 56%;"><div class="h5">September 25, 2026</div><div class="h5">By The Weekly</div><div class="h5">The lead line</div><div class="p">Story.</div></div>
<div id="text-center" class="h5" style="clear: both;"><a href="https://news.example/story" target="_blank">Read the article</a></div></div></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "item") throw new Error(p.kind);
    expect(p.item.details).toEqual(["September 25, 2026", "By The Weekly"]);
    expect(p.item.lead).toBe("The lead line");
    expect(p.item.links).toEqual([
      { label: "Read the article", link: { kind: "external", href: "https://news.example/story" } },
    ]);
    expect(p.item.otherNews).toEqual([
      {
        title: "Older story",
        link: { kind: "item", item: "2", type: "news", ret: "9", menuHandle: "9" },
        meta: ["Sep 24, 2026"],
      },
    ]);
  });

  it("reads the front page's sponsors", () => {
    const sponsor = (href: string, img: string, name: string) =>
      `<div id="text-center" style="float: left;width: 16.5%;"><a href="${href}" target="_blank" class="sponsor" title="Visit ${name}"><img src="${img}"></a><br><a href="${href}" target="_blank" class="sponsor">${name}</a></div>`;
    const html = page(
      "Home",
      `<div style="padding-left: 4vw;"><h5 id="text-center">Free thanks to its <a href="page.php?type=supporters">supporters</a></h5>
<div id="div-center">${sponsor("https://a.example", "directory/1.jpg", "Alpha")}${sponsor("https://b.example", "directory/2.jpg", "Beta")}${sponsor("page.php?type=item&menu_type=directory&return=home&item_handle=7", "directory/3.jpg", "Gamma")}</div></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "home") throw new Error(p.kind);
    expect(p.tagline).toBe("A Community Website by Lopez Island");
    expect(p.sponsors.map((s) => [s.name, s.link?.kind, s.logo])).toEqual([
      ["Alpha", "external", "https://lopezrocks.org/directory/1.jpg"],
      ["Beta", "external", "https://lopezrocks.org/directory/2.jpg"],
      ["Gamma", "item", "https://lopezrocks.org/directory/3.jpg"],
    ]);
  });

  it("recognises a missing section", () => {
    const html = page("", `<h5 id="text-center">This section cannot be found ("")</h5>`);
    expect(parseLopezRocks(html).page).toEqual({ kind: "missing" });
  });

  it("refuses the firewall's browser check rather than reading it as a page", () => {
    const check = `<html><title>You are being redirected...</title><noscript>Javascript is required.</noscript><script>var sucuri_cloudproxy_js='';</script></html>`;
    expect(() => parseLopezRocks(check)).toThrow(LrNotAPage);
  });
});

describe("safety", () => {
  it("keeps a post's markup out of what it returns", () => {
    const html = page(
      "Item",
      `<div id="div-center"><div style="float: left;width: 72%;"><div class="h3">Title <b>bold</b></div>
<div style="float: left;width: 56%;"><div class="p">Hello <script>alert(1)</script><b onclick="alert(2)">there</b> <img src="x" onerror="alert(3)"><a href="javascript:alert(4)">click</a> <iframe src="https://evil.example"></iframe>end</div></div></div></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "item") throw new Error(p.kind);
    const body = p.item.body[0];
    expect(textOf(body)).toBe("Hello there click end");
    expect(body.every((r) => !r.link)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/<|onerror|onclick|javascript:/);
    expect(p.item.title).toBe("Title bold");
  });

  it("drops the site's own icons and plain-http outside pictures", () => {
    const html = page(
      "Item",
      `<div id="div-center"><div style="float: left;width: 72%;"><div class="h3">Pictures</div>
<div style="float: left;width: 42%;"><div><img src="images/share this.png"></div><div><img src="http://plain.example/a.jpg"></div><div><img src="https://ok.example/b.jpg"></div><div><img src="news/1.jpg"></div></div></div></div>`,
    );
    const p = parseLopezRocks(html).page;
    if (p.kind !== "item") throw new Error(p.kind);
    expect(p.item.images.map((i) => i.src)).toEqual(["https://ok.example/b.jpg", "https://lopezrocks.org/news/1.jpg"]);
  });
});
