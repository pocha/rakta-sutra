package fyi.pocha.trackblood;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // TEMPORARY debugging aid — lets chrome://inspect attach to this release
  // build's WebView (off by default on release builds). Remove before
  // shipping the next real release.
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WebView.setWebContentsDebuggingEnabled(true);
  }
}
