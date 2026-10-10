package org.hackeros.bitio.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun rememberInlineColors(): InlineColors {
    val link = MaterialTheme.colorScheme.primary
    val code = MaterialTheme.colorScheme.surfaceVariant
    return remember(link, code) { InlineColors(link, code) }
}

/** One Markdown block as native Compose widgets. Use inside a LazyColumn `items(blocks)`. */
@Composable
fun MdBlockView(block: MdBlock, modifier: Modifier = Modifier) {
    val colors = rememberInlineColors()
    val scheme = MaterialTheme.colorScheme
    when (block) {
        is MdBlock.Heading -> {
            val style = when (block.level) {
                1 -> MaterialTheme.typography.headlineMedium
                2 -> MaterialTheme.typography.titleLarge
                3 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            }
            Column(modifier.padding(top = if (block.level <= 2) 14.dp else 8.dp, bottom = 2.dp)) {
                Text(
                    remember(block.text, colors) { InlineMarkdown.render(block.text, colors) },
                    style = style.copy(fontWeight = FontWeight.Bold),
                )
                if (block.level <= 2) HorizontalDivider(Modifier.padding(top = 4.dp), color = scheme.outlineVariant)
            }
        }
        is MdBlock.Paragraph -> Text(
            remember(block.text, colors) { InlineMarkdown.render(block.text, colors) },
            style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp),
            modifier = modifier.padding(vertical = 4.dp),
        )
        is MdBlock.Code -> CodeBlock(block.code, modifier.padding(vertical = 4.dp))
        is MdBlock.Quote -> Row(modifier.padding(vertical = 4.dp).height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(scheme.primary.copy(alpha = 0.6f)))
            Column(Modifier.padding(start = 12.dp)) {
                for (b in block.blocks) MdBlockView(b)
            }
        }
        is MdBlock.Item -> Row(modifier.padding(start = (block.depth * 16).dp, top = 2.dp, bottom = 2.dp)) {
            val marker = when (block.checked) {
                true -> "☑"
                false -> "☐"
                null -> block.marker
            }
            Text(marker, modifier = Modifier.width(26.dp), style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
            Text(
                remember(block.text, colors) { InlineMarkdown.render(block.text, colors) },
                style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp),
            )
        }
        is MdBlock.Table -> TableView(block, modifier.padding(vertical = 6.dp))
        MdBlock.Rule -> HorizontalDivider(modifier.padding(vertical = 10.dp), color = scheme.outlineVariant)
    }
}

@Composable
fun CodeBlock(code: String, modifier: Modifier = Modifier) {
    val scroll = rememberScrollState()
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .horizontalScroll(scroll)
            .padding(12.dp),
    ) {
        Text(
            code,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.5.sp,
            lineHeight = 18.sp,
            softWrap = false,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun TableView(t: MdBlock.Table, modifier: Modifier = Modifier) {
    val colors = rememberInlineColors()
    val scroll = rememberScrollState()
    val scheme = MaterialTheme.colorScheme
    Column(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .horizontalScroll(scroll),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Row(Modifier.background(scheme.surfaceVariant)) {
            for (cell in t.header) {
                Text(
                    remember(cell, colors) { InlineMarkdown.render(cell, colors) },
                    modifier = Modifier.widthIn(min = 110.dp, max = 220.dp).padding(8.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    overflow = TextOverflow.Clip,
                )
            }
        }
        for (row in t.rows) {
            HorizontalDivider(color = scheme.outlineVariant)
            Row {
                for (cell in row) {
                    Text(
                        remember(cell, colors) { InlineMarkdown.render(cell, colors) },
                        modifier = Modifier.widthIn(min = 110.dp, max = 220.dp).padding(8.dp),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
