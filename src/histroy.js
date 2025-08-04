function getHistory() {
    const regex = /^(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日$/;

    const result = {};

    document
        .querySelector("table.account_table")
        .querySelectorAll("tr[data-panel]")
        .forEach((tr) => {
            const tds = tr.querySelectorAll("td");
            const date = tds[0].textContent;
            const match = date.match(regex);

            let formattedDate;
            if (match) {
                const year = match[1];
                const month = String(match[2]).padStart(2, "0"); // 补齐两位数
                const day = String(match[3]).padStart(2, "0"); // 补齐两位数
                formattedDate = `${year}-${month}-${day}`;
            }

            const name = tds[1].textContent.replaceAll(/\t|\n|移除/g, "");

            result[name] = formattedDate;
        });

    return result;
}
