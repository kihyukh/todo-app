import Foundation

var checks = 0
func check(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fatalError(message) }
    checks += 1
}

for raw in ["https://example.com/paper", "http://example.com/paper.pdf", "mailto:reader@example.com", "HTTPS://example.com/"] {
    check(DaymarkWebBridge.externalLinkURL(raw) != nil, "Expected an external resource: \(raw)")
}
for raw in ["javascript:alert(1)", "data:text/html,test", "file:///tmp/paper.pdf", "daymark://attachment/paper.pdf", "daymark://app/index.html", "about:blank", "https:", "relative.pdf", ""] {
    check(DaymarkWebBridge.externalLinkURL(raw) == nil, "Must not route this through the external browser: \(raw)")
}
print("Passed \(checks) native link routing checks")
