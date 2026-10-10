"""Position-based HTML edits: leave unedited markup and asset references intact."""
import html
import re
from html.parser import HTMLParser

VOID = set('area base br col embed hr img input link meta param source track wbr'.split())

class Node:
    def __init__(self, tag, attrs, start, open_end, parent):
        self.tag, self.attrs = tag, dict(attrs)
        self.start, self.open_end, self.parent = start, open_end, parent
        self.close_start = self.end = open_end
        self.children = []

    def has_class(self, name):
        return name in (self.attrs.get('class') or '').split()

class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source, self.nodes, self.stack = source, [], []
        self.offsets = [0]
        for match in re.finditer('\n', source):
            self.offsets.append(match.end())
        self.feed(source)

    def position(self):
        line, col = self.getpos()
        return self.offsets[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start = self.position()
        node = Node(tag, attrs, start, start + len(self.get_starttag_text()), self.stack[-1] if self.stack else None)
        if node.parent:
            node.parent.children.append(node)
        self.nodes.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                node = self.stack[index]
                node.close_start = self.position()
                node.end = self.source.index('>', node.close_start) + 1
                del self.stack[index:]
                break

    def text(self, node):
        body = self.source[node.open_end:node.close_start]
        return html.unescape(re.sub('<[^>]+>', '', body))

    def apply(self, changes):
        # An edited parent supersedes its children (e.g. gallery/teacher cards).
        selected, boundary = [], -1
        for start, end, value in sorted(changes, key=lambda e: (e[0], -e[1])):
            if start >= boundary:
                selected.append((start, end, value))
                boundary = end
        source = self.source
        for start, end, value in reversed(selected):
            source = source[:start] + value + source[end:]
        return source

def opening(source, node, attributes):
    tag = source[node.start:node.open_end]
    for key, value in attributes.items():
        pattern = r'\s' + re.escape(key) + r'(?:\s*=\s*(?:"[^"]*"|\x27[^\x27]*\x27|[^\s>]+))?'
        tag = re.sub(pattern, '', tag, flags=re.I)
        if value is not None:
            addition = ' ' + key + '="' + html.escape(str(value), quote=True) + '"'
            point = tag.rfind('/>') if tag.endswith('/>') else tag.rfind('>')
            tag = tag[:point] + addition + tag[point:]
    return tag
